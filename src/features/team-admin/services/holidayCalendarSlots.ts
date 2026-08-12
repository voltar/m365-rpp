import { publicHolidaySources, publicHolidays } from "../../../data/publicHolidays";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";
import type { PublicHoliday } from "../../../models/capacity";
import { createLogger } from "../../../core/logging";
import { loadHolidayCalendar, saveHolidayCalendar } from "./teamAdminApi";

export const maxPublicHolidayCalendars = 3;
export const maxSchoolHolidayCalendars = 3;
export const holidayCalendarToneKeys = [
  "publicHoliday1",
  "publicHoliday2",
  "publicHoliday3",
  "schoolHoliday1",
  "schoolHoliday2",
  "schoolHoliday3"
] as const;

const logger = createLogger();

/**
 * EO-454: Interpolate year placeholders in holiday calendar source URL.
 * Supports common placeholders:
 * - {year}: 4-digit year (e.g., 2026)
 * - {YYYY}: 4-digit year (e.g., 2026)
 * - {YY}: 2-digit year (e.g., 26)
 */
export function interpolateYearInUrl(sourceUrl: string | undefined, year: number): string {
  if (!sourceUrl) {
    return "";
  }

  const yy = String(year % 100).padStart(2, "0");
  const yyyy = String(year).padStart(4, "0");

  return sourceUrl
    .replace(new RegExp("\\{year\\}", "gu"), yyyy)
    .replace(new RegExp("\\{YYYY\\}", "gu"), yyyy)
    .replace(new RegExp("\\{YY\\}", "gu"), yy);
}

const zurichResourceId = "aad477f6-db39-4d1b-92d8-0885f2d363d1";
const defaultZurichPublicHolidayLabels = new Set([
  "Neujahrstag",
  "Berchtoldstag",
  "Karfreitag",
  "Ostermontag",
  "Tag der Arbeit",
  "Auffahrt",
  "Pfingstmontag",
  "Nationalfeiertag",
  "Weihnachten",
  "Stephanstag"
]);

export type HolidayCalendarKind = "public" | "school";
export type HolidaySourceType = "microsoft" | "json" | "ics";
export type MicrosoftHolidayPreset = "zurich-public" | "st-gallen-school" | "zurich-school";
export type HolidayCalendarTone = (typeof holidayCalendarToneKeys)[number];

export interface HolidayCalendarToneStyle {
  readonly background: string;
  readonly border: string;
  readonly text: string;
}

export interface HolidayCalendarSlot {
  readonly id: string;
  readonly kind: HolidayCalendarKind;
  readonly enabled: boolean;
  readonly displayLabel: string;
  readonly tone: HolidayCalendarTone;
  readonly sourceType: HolidaySourceType;
  readonly sourceUrl?: string;
  readonly microsoftPreset?: MicrosoftHolidayPreset;
}

export interface HolidayCalendarRefreshResult {
  readonly year: number;
  readonly totalDays: number;
  readonly refreshedSlots: readonly { readonly slotId: string; readonly days: number }[];
}

/**
 * EO-454: Detailed feedback for individual slot refresh operations.
 * Includes entry count, warnings, and error messages for observability.
 */
export interface HolidaySlotRefreshFeedback {
  readonly slotId: string;
  readonly displayLabel: string;
  readonly sourceUrl?: string;
  readonly sourceType: HolidaySourceType;
  readonly year: number;
  readonly status: "success" | "warning" | "error" | "no-change";
  readonly entryCount?: number;
  readonly message: string;
  readonly yearMismatchWarning?: boolean;
}

export function createDefaultHolidaySlots(): readonly HolidayCalendarSlot[] {
  const zurichPublicSource = publicHolidaySources.find((source) => !source.location);
  const zurichSchoolSource = publicHolidaySources.find((source) => source.location === "Dübendorf");
  const stGallenSchoolSource = publicHolidaySources.find((source) => source.location === "SG");

  return [
    {
      id: "public-1",
      kind: "public",
      enabled: true,
      displayLabel: "Feiertage Zürich",
      tone: "publicHoliday1",
      sourceType: "microsoft",
      microsoftPreset: "zurich-public",
      sourceUrl: zurichPublicSource?.sourceUrl
    },
    {
      id: "public-2",
      kind: "public",
      enabled: false,
      displayLabel: "Feiertage Quelle 2",
      tone: "publicHoliday2",
      sourceType: "json"
    },
    {
      id: "public-3",
      kind: "public",
      enabled: false,
      displayLabel: "Feiertage Quelle 3",
      tone: "publicHoliday3",
      sourceType: "json"
    },
    {
      id: "school-1",
      kind: "school",
      enabled: true,
      displayLabel: "Schulferien Zürich/Dübendorf",
      tone: "schoolHoliday1",
      sourceType: "microsoft",
      microsoftPreset: "zurich-school",
      sourceUrl: zurichSchoolSource?.sourceUrl
    },
    {
      id: "school-2",
      kind: "school",
      enabled: true,
      displayLabel: "Schulferien St. Gallen",
      tone: "schoolHoliday2",
      sourceType: "microsoft",
      microsoftPreset: "st-gallen-school",
      sourceUrl: stGallenSchoolSource?.sourceUrl
    },
    {
      id: "school-3",
      kind: "school",
      enabled: false,
      displayLabel: "Schulferien Quelle 3",
      tone: "schoolHoliday3",
      sourceType: "json"
    }
  ];
}

export function sanitizeHolidaySlots(input: readonly HolidayCalendarSlot[]): readonly HolidayCalendarSlot[] {
  const normalized = input.map((slot) => ({
    ...slot,
    displayLabel: slot.displayLabel.trim() || defaultLabelForSlot(slot.id, slot.kind),
    sourceUrl: slot.sourceUrl?.trim(),
    tone: isHolidayCalendarTone(slot.tone) ? slot.tone : defaultToneForSlot(slot.id, slot.kind)
  }));

  const publicSlots = normalized.filter((slot) => slot.kind === "public").slice(0, maxPublicHolidayCalendars);
  const schoolSlots = normalized.filter((slot) => slot.kind === "school").slice(0, maxSchoolHolidayCalendars);

  return [...publicSlots, ...schoolSlots];
}

export async function refreshHolidayCalendarsForSlots(
  year: number,
  slots: readonly HolidayCalendarSlot[],
  kindsToRefresh: readonly HolidayCalendarKind[] = ["public", "school"]
): Promise<HolidayCalendarRefreshResult> {
  const sanitizedSlots = sanitizeHolidaySlots(slots);
  const refreshKinds = new Set(kindsToRefresh);
  const currentHolidays = await loadHolidayCalendar(publicHolidays);
  const keptHolidays = currentHolidays.filter((holiday) => !isManagedHolidayForYear(holiday, year, refreshKinds));
  const generatedHolidays: PublicHoliday[] = [];
  const refreshedSlots: { slotId: string; days: number }[] = [];

  for (const slot of sanitizedSlots) {
    if (!refreshKinds.has(slot.kind)) {
      continue;
    }

    if (!slot.enabled) {
      continue;
    }

    const slotEntries = await loadSlotCalendarDays(slot, year);

    generatedHolidays.push(
      ...slotEntries.map((entry) => ({
        ...entry,
        location: createLocationMarker(slot)
      }))
    );

    refreshedSlots.push({ slotId: slot.id, days: slotEntries.length });
  }

  const nextHolidays = dedupeAndSortHolidays([...keptHolidays, ...generatedHolidays]);
  await saveHolidayCalendar(nextHolidays);

  return {
    year,
    totalDays: generatedHolidays.length,
    refreshedSlots
  };
}

/**
 * EO-454: Refresh holiday calendar slots with detailed per-slot feedback.
 * Returns structured feedback for each slot (success/warning/error/no-change)
 * for user-facing notifications and observability.
 */
export async function refreshHolidayCalendarSlotsWithFeedback(
  year: number,
  slots: readonly HolidayCalendarSlot[],
  kindsToRefresh: readonly HolidayCalendarKind[] = ["public", "school"]
): Promise<readonly HolidaySlotRefreshFeedback[]> {
  const sanitizedSlots = sanitizeHolidaySlots(slots);
  const refreshKinds = new Set(kindsToRefresh);
  const feedback: HolidaySlotRefreshFeedback[] = [];

  for (const slot of sanitizedSlots) {
    if (!refreshKinds.has(slot.kind)) {
      continue;
    }

    if (!slot.enabled) {
      feedback.push({
        slotId: slot.id,
        displayLabel: slot.displayLabel,
        sourceUrl: slot.sourceUrl,
        sourceType: slot.sourceType,
        year,
        status: "no-change",
        message: `${slot.displayLabel} ist deaktiviert`
      });
      continue;
    }

    if (slot.sourceType === "microsoft" && !slot.microsoftPreset) {
      feedback.push({
        slotId: slot.id,
        displayLabel: slot.displayLabel,
        sourceUrl: slot.sourceUrl,
        sourceType: slot.sourceType,
        year,
        status: "error",
        message: `${slot.displayLabel}: Kein Microsoft-Preset konfiguriert`
      });
      continue;
    }

    if (!slot.sourceUrl && slot.sourceType !== "microsoft") {
      feedback.push({
        slotId: slot.id,
        displayLabel: slot.displayLabel,
        sourceUrl: slot.sourceUrl,
        sourceType: slot.sourceType,
        year,
        status: "error",
        message: `${slot.displayLabel}: Keine Quell-URL konfiguriert`
      });
      continue;
    }

    try {
      const slotEntries = await loadSlotCalendarDays(slot, year);
      const interpolatedUrl = interpolateYearInUrl(slot.sourceUrl, year);

      if (slotEntries.length === 0) {
        feedback.push({
          slotId: slot.id,
          displayLabel: slot.displayLabel,
          sourceUrl: interpolatedUrl,
          sourceType: slot.sourceType,
          year,
          status: "no-change",
          entryCount: 0,
          message: `${slot.displayLabel}: Keine neuen Einträge gefunden`
        });
      } else {
        // Check if any entries have year mismatch warning
        const hasYearMismatch = slotEntries.some((entry) => !entry.date.startsWith(`${year}-`));

        feedback.push({
          slotId: slot.id,
          displayLabel: slot.displayLabel,
          sourceUrl: interpolatedUrl,
          sourceType: slot.sourceType,
          year,
          status: hasYearMismatch ? "warning" : "success",
          entryCount: slotEntries.length,
          message: hasYearMismatch
            ? `${slot.displayLabel}: ${slotEntries.length} Einträge geladen (Warnung: Daten stammen teils aus anderem Jahr)`
            : `${slot.displayLabel}: ${slotEntries.length} Einträge aktualisiert`,
          yearMismatchWarning: hasYearMismatch
        });
      }
    } catch (error) {
      feedback.push({
        slotId: slot.id,
        displayLabel: slot.displayLabel,
        sourceUrl: interpolateYearInUrl(slot.sourceUrl, year),
        sourceType: slot.sourceType,
        year,
        status: "error",
        message: `${slot.displayLabel}: Fehler beim Laden (${error instanceof Error ? error.message : "Unbekannter Fehler"})`
      });
    }
  }

  // If we gathered feedback, also perform the actual refresh in the background
  if (feedback.some((f) => f.status === "success")) {
    try {
      await refreshHolidayCalendarsForSlots(year, slots, kindsToRefresh);
    } catch (error) {
      logger.error("Background holiday calendar refresh failed", {
        source: "holidayCalendarSlots.refreshHolidayCalendarSlotsWithFeedback",
        operation: "backgroundRefresh",
        details: { year, slotCount: slots.length }
      }, error);
    }
  }

  return feedback;
}

export function isManagedPublicHoliday(holiday: PublicHoliday): boolean {
  return !holiday.location || holiday.location.startsWith("public-");
}

export function isManagedSchoolHoliday(holiday: PublicHoliday): boolean {
  return Boolean(holiday.location && holiday.location.startsWith("school-"));
}

function isManagedHolidayForYear(
  holiday: PublicHoliday,
  year: number,
  refreshKinds: ReadonlySet<HolidayCalendarKind>
): boolean {
  if (!holiday.date.startsWith(`${year}-`)) {
    return false;
  }

  if (refreshKinds.has("public") && isManagedPublicHoliday(holiday)) {
    return true;
  }

  if (refreshKinds.has("school") && isManagedSchoolHoliday(holiday)) {
    return true;
  }

  // Legacy EO-416 location markers that should be replaced by slot-based values.
  if (refreshKinds.has("public") && !holiday.location) {
    return true;
  }

  if (refreshKinds.has("school")) {
    return holiday.location === "SG" || holiday.location === "Dübendorf" || holiday.location === "Custom";
  }

  return false;
}

async function loadSlotCalendarDays(slot: HolidayCalendarSlot, year: number): Promise<readonly PublicHoliday[]> {
  if (slot.sourceType === "microsoft") {
    return loadMicrosoftPresetDays(slot, year);
  }

  if (!slot.sourceUrl) {
    logger.warn(
      `Holiday slot has no sourceUrl configured; skipping load`,
      {
        source: "holidayCalendarSlots.loadSlotCalendarDays",
        operation: "loadSlotCalendarDays",
        details: { slotId: slot.id, slotKind: slot.kind, sourceType: slot.sourceType }
      }
    );
    return [];
  }

  // EO-454: Interpolate year placeholders in source URL
  const interpolatedUrl = interpolateYearInUrl(slot.sourceUrl, year);

  try {
    const payload = await fetchCalendarPayload(interpolatedUrl, slot.sourceType);
    const holidays = slot.sourceType === "ics" ? parseIcsCalendar(payload, year) : parseJsonCalendar(payload, year);

    if (holidays.length === 0) {
      logger.info(
        `Holiday calendar source returned no entries`,
        {
          source: "holidayCalendarSlots.loadSlotCalendarDays",
          operation: "loadSlotCalendarDays",
          details: { slotId: slot.id, slotKind: slot.kind, sourceUrl: interpolatedUrl, year }
        }
      );
    } else {
      logger.info(
        `Holiday calendar source loaded successfully`,
        {
          source: "holidayCalendarSlots.loadSlotCalendarDays",
          operation: "loadSlotCalendarDays",
          details: { slotId: slot.id, slotKind: slot.kind, sourceUrl: interpolatedUrl, year, entryCount: holidays.length }
        }
      );
    }

    return holidays;
  } catch (error) {
    logger.error(
      `Failed to load holiday calendar from source`,
      {
        source: "holidayCalendarSlots.loadSlotCalendarDays",
        operation: "loadSlotCalendarDays",
        details: {
          slotId: slot.id,
          slotKind: slot.kind,
          sourceType: slot.sourceType,
          sourceUrl: interpolatedUrl,
          year,
          error: error instanceof Error ? error.message : String(error)
        }
      },
      error
    );
    return [];
  }
}

async function loadMicrosoftPresetDays(slot: HolidayCalendarSlot, year: number): Promise<readonly PublicHoliday[]> {
  const preset = slot.microsoftPreset
    ?? (slot.kind === "public" ? "zurich-public" : "st-gallen-school");

  if (preset === "zurich-public") {
    return fetchZurichPublicHolidays(year);
  }

  if (preset === "zurich-school") {
    return fetchZurichSchoolHolidays(year);
  }

  return fetchStGallenSchoolHolidays(year);
}

async function fetchCalendarPayload(url: string, sourceType: HolidaySourceType): Promise<string> {
  const response = await resilientFetch(url, {
    headers: {
      Accept: sourceType === "ics" ? "text/calendar,text/plain" : "application/json,application/*+json,text/plain"
    }
  }, {
    component: "holidayCalendarSlots",
    operation: "fetchConfiguredCalendar"
  });

  if (!response.ok) {
    throw new Error(`Calendar source request failed with ${response.status}.`);
  }

  return response.text();
}

async function fetchZurichPublicHolidays(year: number): Promise<readonly PublicHoliday[]> {
  const sql = [
    `SELECT start_date,end_date,summary FROM "${zurichResourceId}"`,
    `WHERE start_date >= '${year}-01-01'`,
    `AND start_date < '${year + 1}-01-01'`,
    "AND summary NOT LIKE 'Schulen Stadt Zürich:%'",
    "ORDER BY start_date"
  ].join(" ");
  const url = `https://data.stadt-zuerich.ch/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
  const response = await fetchJson<ZurichCalendarResponse>(url);
  const records = response.result?.records ?? [];

  return dedupeAndSortHolidays(records
    .filter((record) => defaultZurichPublicHolidayLabels.has(record.summary))
    .flatMap((record) => expandExclusiveRange(record.start_date.slice(0, 10), record.end_date.slice(0, 10), record.summary)));
}

async function fetchZurichSchoolHolidays(year: number): Promise<readonly PublicHoliday[]> {
  const sql = [
    `SELECT start_date,end_date,summary FROM "${zurichResourceId}"`,
    `WHERE start_date >= '${year}-01-01'`,
    `AND start_date < '${year + 1}-01-01'`,
    "AND summary LIKE 'Schulen Stadt Zürich:%'",
    "AND summary NOT LIKE '%1. Schultag%'",
    "AND summary NOT LIKE '%Schuljahresbeginn%'",
    "AND summary NOT LIKE '%Schulschluss%'",
    "ORDER BY start_date"
  ].join(" ");
  const url = `https://data.stadt-zuerich.ch/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
  const response = await fetchJson<ZurichCalendarResponse>(url);
  const records = response.result?.records ?? [];

  return records.flatMap((record) =>
    expandExclusiveRange(record.start_date.slice(0, 10), record.end_date.slice(0, 10), normalizeZurichSchoolHolidayLabel(record.summary))
  );
}

async function fetchStGallenSchoolHolidays(year: number): Promise<readonly PublicHoliday[]> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year + 1}-01-01`;
  const where = encodeURIComponent(`beginnt_am>=date'${fromDate}' and beginnt_am<date'${toDate}'`);
  const url = `https://daten.stadt.sg.ch/api/explore/v2.1/catalog/datasets/schulferien-feiertage-stadt-stgallen/exports/json?where=${where}`;
  const response = await fetchJson<readonly StGallenRecord[]>(url);

  return response.flatMap((record) => expandExclusiveRange(record.beginnt_am, record.endet_am, record.betreff));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await resilientFetch(url, { headers: { Accept: "application/json" } }, {
    component: "holidayCalendarSlots",
    operation: "fetchJson"
  });

  if (!response.ok) {
    throw new Error(`Calendar source request failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function parseJsonCalendar(payload: string, year?: number): readonly PublicHoliday[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    const records = collectCalendarRecords(parsed);

    return records.flatMap((record) => expandCalendarRecord(record, year));
  } catch {
    return [];
  }
}

function parseIcsCalendar(payload: string, year: number): readonly PublicHoliday[] {
  const events = payload
    .replace(/\r\n?/gu, "\n")
    .split(/\nBEGIN:VEVENT\n/gu)
    .slice(1)
    .map((block) => block.split(/\nEND:VEVENT\n?/u)[0]);

  return events.flatMap((event) => parseIcsEvent(event, year));
}

function collectCalendarRecords(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCalendarRecords(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const nestedKeys = ["records", "results", "events", "holidays", "items", "data"];

  for (const nestedKey of nestedKeys) {
    const nested = record[nestedKey];

    if (Array.isArray(nested)) {
      const nestedRecords = nested.flatMap((entry) => collectCalendarRecords(entry));
      if (nestedRecords.length > 0) {
        return nestedRecords;
      }
    }

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedRecords = collectCalendarRecords(nested);
      if (nestedRecords.length > 0) {
        return nestedRecords;
      }
    }
  }

  return [record];
}

function expandCalendarRecord(record: Record<string, unknown>, year?: number): readonly PublicHoliday[] {
  const startValue = getRecordValue(record, ["start", "startDate", "start_date", "date", "dtstart"]);
  const endValue = getRecordValue(record, ["end", "endDate", "end_date", "dtend"]);
  let label = getRecordValue(record, ["summary", "label", "title", "description"]) ?? "Imported holiday";

  // openholidaysapi.org uses name: [{language: "DE", text: "..."}, ...]
  if (!label || label === "Imported holiday") {
    const nameField = record.name;
    if (Array.isArray(nameField) && nameField.length > 0) {
      const nameObj = nameField[0];
      if (typeof nameObj === "object" && nameObj !== null && "text" in nameObj) {
        const text = (nameObj as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          label = text.trim();
        }
      }
    }
  }

  if (!startValue) {
    return [];
  }

  const startDate = normalizeCalendarDate(startValue, year);
  const endDate = endValue ? normalizeCalendarDate(endValue, year) : undefined;

  if (!startDate) {
    return [];
  }

  if (endDate && endDate.getTime() > startDate.getTime()) {
    const holidays: PublicHoliday[] = [];
    const cursor = new Date(startDate);

    while (cursor.getTime() < endDate.getTime()) {
      holidays.push({ date: formatDateKey(cursor), label: String(label) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return holidays;
  }

  return [{ date: formatDateKey(startDate), label: String(label) }];
}

function parseIcsEvent(event: string, year: number): readonly PublicHoliday[] {
  const summaryMatch = event.match(/(?:^|\n)SUMMARY:(.*)(?:\n|$)/u);
  const startMatch = event.match(/(?:^|\n)DTSTART(?:;[^:]+)?:([^\n]+)/u);
  const endMatch = event.match(/(?:^|\n)DTEND(?:;[^:]+)?:([^\n]+)/u);
  const label = summaryMatch?.[1]?.trim() ?? "Imported holiday";
  const startDate = startMatch ? normalizeCalendarDate(startMatch[1].trim(), year) : undefined;
  const endDate = endMatch ? normalizeCalendarDate(endMatch[1].trim(), year) : undefined;

  if (!startDate) {
    return [];
  }

  if (endDate && endDate.getTime() > startDate.getTime()) {
    const holidays: PublicHoliday[] = [];
    const cursor = new Date(startDate);

    while (cursor.getTime() < endDate.getTime()) {
      holidays.push({ date: formatDateKey(cursor), label: String(label) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return holidays;
  }

  return [{ date: formatDateKey(startDate), label: String(label) }];
}

function getRecordValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizeCalendarDate(value: string, year?: number): Date | undefined {
  const trimmed = value.trim();

  if (/^\d{8}$/u.test(trimmed)) {
    const parsed = new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00.000Z`);
    validateYearMatch(parsed, year, trimmed);
    return parsed;
  }

  if (/^\d{8}T\d{6}Z$/u.test(trimmed)) {
    const parsed = new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(11, 13)}:${trimmed.slice(13, 15)}.000Z`);
    validateYearMatch(parsed, year, trimmed);
    return parsed;
  }

  const parsed = new Date(trimmed);

  if (!Number.isNaN(parsed.getTime())) {
    validateYearMatch(parsed, year, trimmed);
    return parsed;
  }

  if (/^\d{2}-\d{2}$/u.test(trimmed) && year) {
    const parsed = new Date(`${year}-${trimmed}T00:00:00.000Z`);
    validateYearMatch(parsed, year, trimmed);
    return parsed;
  }

  return undefined;
}

function validateYearMatch(parsedDate: Date, expectedYear: number | undefined, rawValue: string): void {
  if (!expectedYear) {
   return;
  }

  const actualYear = parsedDate.getUTCFullYear();
  if (actualYear !== expectedYear) {
   logger.warn(
     `Holiday calendar source returned date from unexpected year; configured for year-scoped load`,
     {
       source: "holidayCalendarSlots.parseJsonCalendar",
       component: "expandCalendarRecord",
       operation: "normalizeCalendarDate",
       details: {
         expectedYear,
         actualYear,
         rawValue,
         dateStr: parsedDate.toISOString()
       }
     }
   );
  }
}

function expandExclusiveRange(startDateKey: string, endDateKeyExclusive: string, label: string): readonly PublicHoliday[] {
  const start = parseDateKey(startDateKey);
  const endExclusive = parseDateKey(endDateKeyExclusive);
  const holidays: PublicHoliday[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() < endExclusive.getTime()) {
    holidays.push({ date: formatDateKey(cursor), label });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return holidays;
}

function normalizeZurichSchoolHolidayLabel(summary: string): string {
  return summary.replace(/^Schulen Stadt Zürich:\s*/u, "").trim() || "School holiday";
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dedupeAndSortHolidays(holidays: readonly PublicHoliday[]): readonly PublicHoliday[] {
  return Array
    .from(new Map(holidays.map((holiday) => [`${holiday.date}|${holiday.location ?? "default"}|${holiday.label}`, holiday])).values())
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }

      return (a.location ?? "").localeCompare(b.location ?? "") || a.label.localeCompare(b.label);
    });
}

function defaultLabelForSlot(slotId: string, kind: HolidayCalendarKind): string {
  if (slotId === "public-1") {
    return "Feiertage Zürich";
  }

  if (slotId === "school-1") {
    return "Schulferien Zürich/Dübendorf";
  }

  if (slotId === "school-2") {
    return "Schulferien St. Gallen";
  }

  return kind === "public" ? "Feiertage" : "Schulferien";
}

function createLocationMarker(slot: HolidayCalendarSlot): string {
  const encodedLabel = encodeURIComponent(slot.displayLabel.trim() || defaultLabelForSlot(slot.id, slot.kind));
  return `${slot.id}:${encodedLabel}:${slot.tone}`;
}

export function getHolidayCalendarToneStyle(tone: HolidayCalendarTone): HolidayCalendarToneStyle {
  const tokenByTone: Record<HolidayCalendarTone, { readonly background: string; readonly border: string; readonly text: string }> = {
    publicHoliday1: {
      background: "var(--colorPaletteMarigoldBackground2)",
      border: "var(--colorPaletteMarigoldBorderActive)",
      text: "var(--colorPaletteMarigoldForeground2)"
    },
    publicHoliday2: {
      background: "var(--colorPaletteCranberryBackground2)",
      border: "var(--colorPaletteCranberryBorderActive)",
      text: "var(--colorPaletteCranberryForeground2)"
    },
    publicHoliday3: {
      background: "var(--colorPaletteDarkOrangeBackground2)",
      border: "var(--colorPaletteDarkOrangeBorderActive)",
      text: "var(--colorPaletteDarkOrangeForeground2)"
    },
    schoolHoliday1: {
      background: "var(--colorPaletteBlueBackground2)",
      border: "var(--colorPaletteBlueBorderActive)",
      text: "var(--colorPaletteBlueForeground2)"
    },
    schoolHoliday2: {
      background: "var(--colorPaletteGreenBackground2)",
      border: "var(--colorPaletteGreenBorderActive)",
      text: "var(--colorPaletteGreenForeground2)"
    },
    schoolHoliday3: {
      background: "var(--colorPaletteCornflowerBackground2)",
      border: "var(--colorPaletteCornflowerBorderActive)",
      text: "var(--colorPaletteCornflowerForeground2)"
    }
  };

  return tokenByTone[tone];
}

export function isHolidayCalendarTone(value: string | undefined): value is HolidayCalendarTone {
  return Boolean(value) && (holidayCalendarToneKeys as readonly string[]).includes(value as string);
}

export function defaultToneForSlot(slotId: string, kind: HolidayCalendarKind): HolidayCalendarTone {
  if (slotId === "public-1") {
    return "publicHoliday1";
  }

  if (slotId === "public-2") {
    return "publicHoliday2";
  }

  if (slotId === "public-3") {
    return "publicHoliday3";
  }

  if (slotId === "school-1") {
    return "schoolHoliday1";
  }

  if (slotId === "school-2") {
    return "schoolHoliday2";
  }

  if (slotId === "school-3") {
    return "schoolHoliday3";
  }

  return kind === "public" ? "publicHoliday1" : "schoolHoliday1";
}

interface StGallenRecord {
  readonly betreff: string;
  readonly beginnt_am: string;
  readonly endet_am: string;
}

interface ZurichCalendarResponse {
  readonly result?: {
    readonly records?: readonly ZurichCalendarRecord[];
  };
}

interface ZurichCalendarRecord {
  readonly start_date: string;
  readonly end_date: string;
  readonly summary: string;
}
