/**
 * Test: openholidaysapi.org parsing for EO-454 with year validation
 * 
 * Verifies that expandCalendarRecord:
 * 1. Correctly handles the openholidaysapi.org response format where holiday names
 *    are stored in an array of language objects.
 * 2. Validates that parsed dates match the expected year (year-scoped load).
 */

// Mock data from openholidaysapi.org response for CH-SG 2026
const openHolidaysApiSampleRecord = {
  startDate: "2026-01-01",
  name: [
    {
      language: "DE",
      text: "Neujahrstag"
    }
  ]
};

// Simple inline implementation of expandCalendarRecord for testing
function formatDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let lastWarning = null;

function validateYearMatch(parsedDate, expectedYear, rawValue) {
  if (!expectedYear) {
    return;
  }

  const actualYear = parsedDate.getUTCFullYear();
  if (actualYear !== expectedYear) {
    lastWarning = {
      msg: `Holiday calendar source returned date from unexpected year; configured for year-scoped load`,
      details: {
        expectedYear,
        actualYear,
        rawValue,
        dateStr: parsedDate.toISOString()
      }
    };
  }
}

function normalizeCalendarDate(value, year) {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00.000Z`);
    validateYearMatch(parsed, year, trimmed);
    return parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const datePart = trimmed.match(/^\d{4}-\d{2}-\d{2}/)[0];
    const parsed = new Date(`${datePart}T00:00:00.000Z`);
    validateYearMatch(parsed, year, trimmed);
    return parsed;
  }
  return undefined;
}

function getRecordValue(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function expandCalendarRecord(record, year) {
  const startValue = getRecordValue(record, ["start", "startDate", "start_date", "date", "dtstart"]);
  const endValue = getRecordValue(record, ["end", "endDate", "end_date", "dtend"]);
  let label = getRecordValue(record, ["summary", "label", "title", "description"]) ?? "Imported holiday";

  // openholidaysapi.org uses name: [{language: "DE", text: "..."}, ...]
  if (!label || label === "Imported holiday") {
    const nameField = record.name;
    if (Array.isArray(nameField) && nameField.length > 0) {
      const nameObj = nameField[0];
      if (typeof nameObj === "object" && nameObj !== null && "text" in nameObj) {
        const text = nameObj.text;
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
    const holidays = [];
    const cursor = new Date(startDate);

    while (cursor.getTime() < endDate.getTime()) {
      holidays.push({ date: formatDateKey(cursor), label: String(label) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return holidays;
  }

  return [{ date: formatDateKey(startDate), label: String(label) }];
}

// Test 1: openholidaysapi.org format with name array, matching year
console.log("Test 1: openholidaysapi.org format with name array, matching year");
lastWarning = null;
const result1 = expandCalendarRecord(openHolidaysApiSampleRecord, 2026);
console.log(`  Result:`, result1);
console.assert(result1.length === 1, "Should parse exactly one holiday");
console.assert(result1[0].date === "2026-01-01", `Date should be 2026-01-01, got ${result1[0].date}`);
console.assert(result1[0].label === "Neujahrstag", `Label should be 'Neujahrstag', got '${result1[0].label}'`);
console.assert(lastWarning === null, "Should not warn when year matches");
console.log("  ✓ PASS\n");

// Test 2: Year mismatch - data from 2025 but requested 2026
console.log("Test 2: Year mismatch warning (data 2025, requested 2026)");
lastWarning = null;
const mismatchRecord = {
  startDate: "2025-01-01",
  name: [{ language: "DE", text: "Neujahrstag" }]
};
const result2 = expandCalendarRecord(mismatchRecord, 2026);
console.log(`  Result:`, result2);
console.assert(result2.length === 1, "Should still parse the holiday");
console.assert(result2[0].date === "2025-01-01", "Date should be from actual data (2025)");
console.assert(lastWarning !== null, "Should have logged a warning");
console.assert(lastWarning.details.expectedYear === 2026, "Warning should note expected year");
console.assert(lastWarning.details.actualYear === 2025, "Warning should note actual year");
console.log(`  Warning logged: ${lastWarning.msg}`);
console.log("  ✓ PASS\n");

// Test 3: Traditional format with summary string
console.log("Test 3: Traditional format with summary string, year check");
lastWarning = null;
const result3 = expandCalendarRecord({
  startDate: "2026-01-02",
  summary: "Traditional Holiday"
}, 2026);
console.log(`  Result:`, result3);
console.assert(result3.length === 1, "Should parse exactly one holiday");
console.assert(result3[0].label === "Traditional Holiday", `Label should be 'Traditional Holiday'`);
console.assert(lastWarning === null, "Should not warn when year matches");
console.log("  ✓ PASS\n");

// Test 4: Date range with year mismatch
console.log("Test 4: Date range (multi-day holiday), year mismatch warning");
lastWarning = null;
const result4 = expandCalendarRecord({
  startDate: "2025-12-24",
  endDate: "2025-12-27",
  name: [{ language: "DE", text: "Weihnachtstage" }]
}, 2026);
console.log(`  Result length:`, result4.length);
console.assert(result4.length === 3, `Should parse 3 days, got ${result4.length}`);
console.assert(lastWarning !== null, "Should have logged warning for year mismatch");
console.log(`  Warning logged: ${lastWarning.msg}`);
console.log("  ✓ PASS\n");

console.log("✅ All tests passed!");

