import { publicHolidays } from "../../../data/publicHolidays";
import type { PublicHoliday } from "../../../models/capacity";
import { loadHolidayCalendar, saveHolidayCalendar } from "./teamAdminApi";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";

const zurichResourceId = "aad477f6-db39-4d1b-92d8-0885f2d363d1";

interface CalendarUpdateSourceResult {
  readonly location: NonNullable<PublicHoliday["location"]>;
  readonly addedDays: number;
  readonly warning?: string;
}

export interface CalendarUpdateResult {
  readonly year: number;
  readonly totalDays: number;
  readonly sources: readonly CalendarUpdateSourceResult[];
}

export interface CalendarSourceOptions {
  readonly sourceUrl?: string;
  readonly sourceType?: "json" | "ics";
}

interface StGallenRecord {
  readonly betreff: string;
  readonly beginnt_am: string;
  readonly endet_am: string;
}

interface StGallenResponse {
  readonly results?: readonly StGallenRecord[];
}

interface ZurichRecord {
  readonly start_date: string;
  readonly end_date: string;
  readonly summary: string;
}

interface ZurichResponse {
  readonly result?: {
    readonly records?: readonly ZurichRecord[];
  };
}

export async function updateSchoolHolidayCalendars(year: number, options?: CalendarSourceOptions): Promise<CalendarUpdateResult> {
  // EO-416: current calendar comes from the DB (api mode) or the local mock state.
  const currentHolidays = await loadHolidayCalendar(publicHolidays);
  const keptHolidays = currentHolidays.filter((holiday) => !isManagedSchoolHolidayForYear(holiday, year));
  const sourceResults: CalendarUpdateSourceResult[] = [];
  const fetchedHolidays: PublicHoliday[] = [];

  const configuredHolidays = await fetchConfiguredCalendarHolidays(year, options);

  if (configuredHolidays.length > 0) {
    fetchedHolidays.push(...configuredHolidays);
    sourceResults.push({
      location: "Custom",
      addedDays: configuredHolidays.length
    });
  } else {
    const stGallenHolidays = await fetchStGallenSchoolHolidays(year);
    const stGallenFallback = getBundledSchoolHolidayFallbacks(year, "SG");
    const stGallenEffectiveHolidays = stGallenHolidays.length > 0 ? stGallenHolidays : stGallenFallback;
    const stGallenUsedFallback = stGallenHolidays.length === 0;
    fetchedHolidays.push(...stGallenEffectiveHolidays);
    sourceResults.push({
      location: "SG",
      addedDays: stGallenEffectiveHolidays.length,
      warning: stGallenUsedFallback ? "teamAdminSchoolHolidaySyncStGallenNoData" : undefined
    });

    const zurichHolidays = await fetchZurichSchoolHolidays(year);
    const zurichFallback = getBundledSchoolHolidayFallbacks(year, "Dübendorf");
    const zurichEffectiveHolidays = zurichHolidays.length > 0 ? zurichHolidays : zurichFallback;
    const zurichUsedFallback = zurichHolidays.length === 0;
    fetchedHolidays.push(...zurichEffectiveHolidays);
    sourceResults.push({
      location: "Dübendorf",
      addedDays: zurichEffectiveHolidays.length,
      warning: zurichUsedFallback ? "teamAdminSchoolHolidaySyncZurichNoData" : undefined
    });
  }

  const nextHolidays = sortAndDedupeHolidays([...keptHolidays, ...fetchedHolidays]);
  await saveHolidayCalendar(nextHolidays);

  return {
    year,
    totalDays: fetchedHolidays.length,
    sources: sourceResults
  };
}

async function fetchStGallenSchoolHolidays(year: number): Promise<readonly PublicHoliday[]> {
  const fromDate = `${year}-01-01`;
  const toDate = `${year + 1}-01-01`;
  const where = encodeURIComponent(`beginnt_am>=date'${fromDate}' and beginnt_am<date'${toDate}'`);
  const url = `https://daten.stadt.sg.ch/api/explore/v2.1/catalog/datasets/schulferien-feiertage-stadt-stgallen/records?limit=100&order_by=beginnt_am&where=${where}`;
  const response = await fetchJson<StGallenResponse>(url);
  const records = response.results ?? [];

  return records.flatMap((record) => expandExclusiveRange({
    startDate: record.beginnt_am,
    exclusiveEndDate: record.endet_am,
    label: record.betreff,
    location: "SG"
  }));
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
  const response = await fetchJson<ZurichResponse>(url);
  const records = response.result?.records ?? [];

  return records.flatMap((record) => expandExclusiveRange({
    startDate: record.start_date.slice(0, 10),
    exclusiveEndDate: record.end_date.slice(0, 10),
    label: normalizeZurichSchoolHolidayLabel(record.summary),
    location: "Dübendorf"
  }));
}

async function fetchConfiguredCalendarHolidays(year: number, options?: CalendarSourceOptions): Promise<readonly PublicHoliday[]> {
  const sourceUrl = options?.sourceUrl?.trim();

  if (!sourceUrl) {
    return [];
  }

  const sourceType = options?.sourceType ?? "json";
  const response = await resilientFetch(sourceUrl, {
    headers: {
      Accept: sourceType === "ics" ? "text/calendar,text/plain" : "application/json,application/*+json,text/plain"
    }
  }, {
    component: "schoolHolidayCalendarApi",
    operation: "loadConfiguredCalendar"
  });

  if (!response.ok) {
    throw new Error(`Configured calendar source request failed with ${response.status}.`);
  }

  const payload = await response.text();

  if (sourceType === "ics") {
    return parseIcsCalendar(payload, year);
  }

  return parseJsonCalendar(payload, year);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await resilientFetch(url, { headers: { Accept: "application/json" } }, {
    component: "schoolHolidayCalendarApi",
    operation: "loadCalendar"
  });

  if (!response.ok) {
    throw new Error(`Calendar source request failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function parseJsonCalendar(payload: string, year: number): readonly PublicHoliday[] {
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

function expandCalendarRecord(record: Record<string, unknown>, year: number): readonly PublicHoliday[] {
  const startValue = getRecordValue(record, ["start", "startDate", "start_date", "date", "dtstart"]);
  const endValue = getRecordValue(record, ["end", "endDate", "end_date", "dtend"]);
  const label = getRecordValue(record, ["summary", "label", "title", "name", "description"]) ?? "Imported holiday";

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
      holidays.push({
        date: formatDateKey(cursor),
        label: String(label),
        location: "Custom"
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return holidays;
  }

  return [{ date: formatDateKey(startDate), label: String(label), location: "Custom" }];
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
      holidays.push({ date: formatDateKey(cursor), label: String(label), location: "Custom" });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return holidays;
  }

  return [{ date: formatDateKey(startDate), label: String(label), location: "Custom" }];
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function normalizeCalendarDate(value: string, _year: number): Date | undefined {
  const trimmed = value.trim();

  if (/^\d{8}$/u.test(trimmed)) {
    return new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00.000Z`);
  }

  if (/^\d{8}T\d{6}Z$/u.test(trimmed)) {
    return new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(11, 13)}:${trimmed.slice(13, 15)}.000Z`);
  }

  const parsed = new Date(trimmed);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed) || /^\d{4}-\d{2}-\d{2}T/u.test(trimmed)) {
    return new Date(`${trimmed}Z`);
  }

  return undefined;
}

function expandExclusiveRange(range: {
  readonly startDate: string;
  readonly exclusiveEndDate: string;
  readonly label: string;
  readonly location: NonNullable<PublicHoliday["location"]>;
}): readonly PublicHoliday[] {
  const holidays: PublicHoliday[] = [];
  const cursor = parseDateKey(range.startDate);
  const exclusiveEnd = parseDateKey(range.exclusiveEndDate);

  while (cursor.getTime() < exclusiveEnd.getTime()) {
    holidays.push({
      date: formatDateKey(cursor),
      label: range.label,
      location: range.location
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return holidays;
}

function isManagedSchoolHolidayForYear(holiday: PublicHoliday, year: number): boolean {
  return (holiday.location === "SG" || holiday.location === "Dübendorf") && holiday.date.startsWith(`${year}-`);
}

function normalizeZurichSchoolHolidayLabel(summary: string): string {
  return summary
    .replace(/^Schulen Stadt Zürich:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .trim();
}

function getBundledSchoolHolidayFallbacks(year: number, location: NonNullable<PublicHoliday["location"]>): readonly PublicHoliday[] {
  return publicHolidays.filter((holiday) => holiday.location === location && holiday.date.startsWith(`${year}-`));
}

function sortAndDedupeHolidays(holidays: readonly PublicHoliday[]): readonly PublicHoliday[] {
  const byKey = new Map<string, PublicHoliday>();

  holidays.forEach((holiday) => {
    byKey.set(`${holiday.date}|${holiday.location ?? "federal"}|${holiday.label}`, holiday);
  });

  return Array.from(byKey.values()).sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return (left.location ?? "").localeCompare(right.location ?? "") || left.label.localeCompare(right.label);
  });
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
