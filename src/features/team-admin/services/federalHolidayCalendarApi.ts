import { publicHolidays } from "../../../data/publicHolidays";
import type { PublicHoliday } from "../../../models/capacity";
import { loadHolidayCalendar, saveHolidayCalendar } from "./teamAdminApi";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";

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
const zurichFixedDateHolidays: readonly { readonly monthDay: string; readonly label: string }[] = [
  { monthDay: "01-01", label: "Neujahrstag" },
  { monthDay: "01-02", label: "Berchtoldstag" },
  { monthDay: "05-01", label: "Tag der Arbeit" },
  { monthDay: "08-01", label: "Nationalfeiertag" },
  { monthDay: "12-25", label: "Weihnachten" },
  { monthDay: "12-26", label: "Stephanstag" }
];

export interface FederalHolidayUpdateResult {
  readonly year: number;
  readonly totalDays: number;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export interface CalendarSourceOptions {
  readonly sourceUrl?: string;
  readonly sourceType?: "json" | "ics";
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

export async function updateDefaultZurichPublicHolidays(year: number, options?: CalendarSourceOptions): Promise<FederalHolidayUpdateResult> {
  // EO-416: current calendar comes from the DB (api mode) or the local mock state.
  const currentHolidays = await loadHolidayCalendar(publicHolidays);
  const keptHolidays = currentHolidays.filter((holiday) => holiday.location || !holiday.date.startsWith(`${year}-`));
  const configuredHolidays = await fetchConfiguredCalendarHolidays(year, options);
  const zurichHolidays = configuredHolidays.length > 0 ? configuredHolidays : await fetchZurichPublicHolidays(year);
  const bundledFallbacks = getBundledPublicHolidayFallbacks(year);
  const effectiveZurichHolidays = zurichHolidays.length > 0 ? zurichHolidays : bundledFallbacks;

  await saveHolidayCalendar(sortHolidays([...keptHolidays, ...effectiveZurichHolidays]));

  return {
    year,
    totalDays: effectiveZurichHolidays.length,
    sourceName: "Open Data Stadt Zürich – Ferien und schulfreie Tage der Volksschule",
    sourceUrl: "https://data.stadt-zuerich.ch/api/3/action/datastore_search?resource_id=aad477f6-db39-4d1b-92d8-0885f2d363d1&limit=500"
  };
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
  const sourceHolidays = records
    .filter((record) => defaultZurichPublicHolidayLabels.has(record.summary))
    .flatMap((record) => expandExclusiveRange(record.start_date.slice(0, 10), record.end_date.slice(0, 10), record.summary));
  const fixedDateFallbacks = zurichFixedDateHolidays.map((holiday) => ({
    date: `${year}-${holiday.monthDay}`,
    label: holiday.label
  }));

  return dedupeHolidays([...sourceHolidays, ...fixedDateFallbacks]);
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
    component: "federalHolidayCalendarApi",
    operation: "loadConfiguredCalendar"
  });

  if (!response.ok) {
    throw new Error(`Configured calendar source request failed with ${response.status}.`);
  }

  const payload = await response.text();
  return sourceType === "ics" ? parseIcsCalendar(payload, year) : parseJsonCalendar(payload);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await resilientFetch(url, { headers: { Accept: "application/json" } }, {
    component: "federalHolidayCalendarApi",
    operation: "loadCalendar"
  });

  if (!response.ok) {
    throw new Error(`Zurich public holiday source request failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function parseJsonCalendar(payload: string): readonly PublicHoliday[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    const records = collectCalendarRecords(parsed);
    return records.flatMap((record) => expandCalendarRecord(record));
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

function expandCalendarRecord(record: Record<string, unknown>): readonly PublicHoliday[] {
  const startValue = getRecordValue(record, ["start", "startDate", "start_date", "date", "dtstart"]);
  const endValue = getRecordValue(record, ["end", "endDate", "end_date", "dtend"]);
  const label = getRecordValue(record, ["summary", "label", "title", "name", "description"]) ?? "Imported holiday";

  if (!startValue) {
    return [];
  }

  const startDate = normalizeCalendarDate(startValue);
  const endDate = endValue ? normalizeCalendarDate(endValue) : undefined;

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseIcsEvent(event: string, _year: number): readonly PublicHoliday[] {
  const summaryMatch = event.match(/(?:^|\n)SUMMARY:(.*)(?:\n|$)/u);
  const startMatch = event.match(/(?:^|\n)DTSTART(?:;[^:]+)?:([^\n]+)/u);
  const endMatch = event.match(/(?:^|\n)DTEND(?:;[^:]+)?:([^\n]+)/u);
  const label = summaryMatch?.[1]?.trim() ?? "Imported holiday";
  const startDate = startMatch ? normalizeCalendarDate(startMatch[1].trim()) : undefined;
  const endDate = endMatch ? normalizeCalendarDate(endMatch[1].trim()) : undefined;

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

function normalizeCalendarDate(value: string): Date | undefined {
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

function expandExclusiveRange(startDate: string, exclusiveEndDate: string, label: string): readonly PublicHoliday[] {
  const holidays: PublicHoliday[] = [];
  const cursor = parseDateKey(startDate);
  const exclusiveEnd = parseDateKey(exclusiveEndDate);

  while (cursor.getTime() < exclusiveEnd.getTime()) {
    holidays.push({ date: formatDateKey(cursor), label });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return holidays;
}

function sortHolidays(holidays: readonly PublicHoliday[]): readonly PublicHoliday[] {
  return dedupeHolidays(holidays).sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return (left.location ?? "").localeCompare(right.location ?? "") || left.label.localeCompare(right.label);
  });
}

function dedupeHolidays(holidays: readonly PublicHoliday[]): PublicHoliday[] {
  return Array.from(new Map(holidays.map((holiday) => [`${holiday.date}|${holiday.location ?? "default"}|${holiday.label}`, holiday])).values());
}

function getBundledPublicHolidayFallbacks(year: number): readonly PublicHoliday[] {
  return publicHolidays.filter((holiday) => !holiday.location && holiday.date.startsWith(`${year}-`));
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
