import type { PublicHoliday } from "../models/capacity";

type HolidayLocation = NonNullable<PublicHoliday["location"]>;

interface HolidaySource {
  readonly location?: HolidayLocation;
  readonly name: string;
  readonly sourceUrl: string;
  readonly notes: string;
}

interface HolidayRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly label: string;
  readonly location?: HolidayLocation;
}

export const publicHolidaySources: readonly HolidaySource[] = [
  {
    name: "Open Data Stadt Zürich – Default Feiertagskalender Zürich",
    sourceUrl: "https://data.stadt-zuerich.ch/api/3/action/datastore_search?resource_id=aad477f6-db39-4d1b-92d8-0885f2d363d1&limit=500",
    notes: "Offizieller maschinenlesbarer Zürich-Kalender. Wird als Default-Feiertagskalender verwendet; Schulferien/Schulfreitage werden herausgefiltert."
  },
  {
    location: "SG",
    name: "Open Data Stadt St.Gallen – Schulferien und Feiertage Stadt St.Gallen",
    sourceUrl: "https://daten.stadt.sg.ch/api/explore/v2.1/catalog/datasets/schulferien-feiertage-stadt-stgallen/exports/json",
    notes: "Offizieller JSON-Export. Stand 2026-08-05 enthält der Datensatz Einträge bis Sommerferien 2025; 2026 bleibt deshalb als Fallback manuell gepflegt."
  },
  {
    location: "Dübendorf",
    name: "Open Data Stadt Zürich – Ferien und schulfreie Tage der Volksschule",
    sourceUrl: "https://data.stadt-zuerich.ch/api/3/action/datastore_search?resource_id=aad477f6-db39-4d1b-92d8-0885f2d363d1&limit=500",
    notes: "Offizielle Stadt-Zürich-Daten via CKAN Datastore JSON. Wird als pragmatischer Zürich/Dübendorf-Proxy genutzt, weil keine Dübendorf-spezifische Open-Data-JSON-Quelle gefunden wurde."
  }
];

const publicHolidayRanges: readonly HolidayRange[] = [
  { startDate: "2026-01-01", endDate: "2026-01-01", label: "Neujahrstag" },
  { startDate: "2026-01-02", endDate: "2026-01-02", label: "Berchtoldstag" },
  { startDate: "2026-04-03", endDate: "2026-04-03", label: "Karfreitag" },
  { startDate: "2026-04-06", endDate: "2026-04-06", label: "Ostermontag" },
  { startDate: "2026-05-01", endDate: "2026-05-01", label: "Tag der Arbeit" },
  { startDate: "2026-05-14", endDate: "2026-05-14", label: "Auffahrt" },
  { startDate: "2026-05-25", endDate: "2026-05-25", label: "Pfingstmontag" },
  { startDate: "2026-08-01", endDate: "2026-08-01", label: "Nationalfeiertag" },
  { startDate: "2026-12-25", endDate: "2026-12-25", label: "Weihnachten" },
  { startDate: "2026-12-26", endDate: "2026-12-26", label: "Stephanstag" },

  // St. Gallen fallback until the official Open Data endpoint publishes 2026 records.
  { startDate: "2026-07-11", endDate: "2026-08-23", label: "Summer holidays", location: "SG" },

  // Stadt Zürich Open Data 2026 records, used as Zürich/Dübendorf proxy.
  // Source query: SELECT start_date,end_date,summary FROM datastore WHERE year=2026 AND summary LIKE 'Schulen Stadt Zürich:%'.
  // CKAN all-day end dates are exclusive in the source export; the range below is inclusive for app display.
  { startDate: "2026-02-09", endDate: "2026-02-20", label: "Sport holidays", location: "Dübendorf" },
  { startDate: "2026-07-13", endDate: "2026-08-14", label: "Summer holidays", location: "Dübendorf" },
  { startDate: "2026-10-05", endDate: "2026-10-16", label: "Autumn holidays", location: "Dübendorf" },
  { startDate: "2026-12-21", endDate: "2026-12-31", label: "Christmas holidays", location: "Dübendorf" }
];

export const publicHolidays: readonly PublicHoliday[] = publicHolidayRanges.flatMap(expandHolidayRange);

function expandHolidayRange(range: HolidayRange): readonly PublicHoliday[] {
  const dates: PublicHoliday[] = [];
  const cursor = parseDateKey(range.startDate);
  const end = parseDateKey(range.endDate);

  while (cursor.getTime() <= end.getTime()) {
    dates.push({
      date: formatDateKey(cursor),
      label: range.label,
      ...(range.location ? { location: range.location } : {})
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
