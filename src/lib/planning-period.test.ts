import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedPlanningPeriod, formatPlanningPeriod } from "./planning-period.ts";

test("17 November 2026 defaults to 26Q4S3", () => {
  const period = expectedPlanningPeriod(new Date(2026, 10, 17, 12));
  assert.deepEqual(period, { year: 2026, quarter: 4, sprintNumber: 3 });
  assert.equal(formatPlanningPeriod(period), "26Q4S3");
});

test("sprints change every second Wednesday at local midnight, including across daylight saving", () => {
  for (const [date, sprint] of [
    [new Date(2026, 9, 7), 1],
    [new Date(2026, 9, 20, 23, 59, 59), 1],
    [new Date(2026, 9, 21), 2],
    [new Date(2026, 10, 3, 23, 59, 59), 2],
    [new Date(2026, 10, 4), 3],
    [new Date(2026, 10, 11), 3],
    [new Date(2026, 10, 17, 23, 59, 59), 3],
    [new Date(2026, 10, 18), 4],
  ] as const) {
    assert.equal(expectedPlanningPeriod(date).sprintNumber, sprint, date.toString());
  }
});

test("calendar quarters and years roll over with sprint zero before the first Wednesday", () => {
  assert.deepEqual(expectedPlanningPeriod(new Date(2026, 9, 1)), { year: 2026, quarter: 4, sprintNumber: 0 });
  assert.deepEqual(expectedPlanningPeriod(new Date(2027, 0, 1)), { year: 2027, quarter: 1, sprintNumber: 0 });
  assert.deepEqual(expectedPlanningPeriod(new Date(2027, 0, 6)), { year: 2027, quarter: 1, sprintNumber: 1 });
  assert.deepEqual(expectedPlanningPeriod(new Date(2024, 3, 17)), { year: 2024, quarter: 2, sprintNumber: 2 });
  assert.equal(formatPlanningPeriod({ year: null, quarter: 4, sprintNumber: 3 }), "Q4 · Sprint 3");
  assert.equal(formatPlanningPeriod({ year: null, quarter: null, sprintNumber: null }), "");
});
