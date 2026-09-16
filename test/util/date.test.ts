import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysAgo, formatDate, isoWeekId } from "../../src/util/date.js";

/**
 * Midday local time, so the local date components isoWeekId reads are the same
 * in every timezone. A bare "2026-01-01" would be parsed as UTC midnight and
 * land on the previous day west of Greenwich.
 */
function localNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

describe("isoWeekId", () => {
  it("numbers an ordinary mid-year week", () => {
    assert.equal(isoWeekId(localNoon("2026-09-16")), "2026-W38");
  });

  it("pads single-digit weeks to two digits", () => {
    assert.equal(isoWeekId(localNoon("2026-01-05")), "2026-W02");
  });

  // The Thursday of the week decides which year the week belongs to, so a week
  // straddling New Year is named after the year holding most of it. These are
  // the cases a naive implementation gets wrong.
  describe("year boundaries", () => {
    it("counts late December into the next ISO year", () => {
      // Monday 2025-12-29; its Thursday is 2026-01-01.
      assert.equal(isoWeekId(localNoon("2025-12-29")), "2026-W01");
      // Monday 2024-12-30; its Thursday is 2025-01-02.
      assert.equal(isoWeekId(localNoon("2024-12-30")), "2025-W01");
      // Monday 2019-12-30; its Thursday is 2020-01-02.
      assert.equal(isoWeekId(localNoon("2019-12-30")), "2020-W01");
    });

    it("counts early January back into the previous ISO year", () => {
      // Friday 2021-01-01; its Thursday is 2020-12-31.
      assert.equal(isoWeekId(localNoon("2021-01-01")), "2020-W53");
      // Saturday 2022-01-01; its Thursday is 2021-12-30.
      assert.equal(isoWeekId(localNoon("2022-01-01")), "2021-W52");
    });

    it("keeps January 1st in week 1 when it is a Thursday", () => {
      assert.equal(isoWeekId(localNoon("2026-01-01")), "2026-W01");
    });

    it("emits week 53 for the long years that have one", () => {
      assert.equal(isoWeekId(localNoon("2020-12-31")), "2020-W53");
      assert.equal(isoWeekId(localNoon("2027-01-01")), "2026-W53");
    });
  });

  it("gives every day of one week the same id", () => {
    const week = [
      "2026-09-14", // Monday
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20", // Sunday
    ].map((day) => isoWeekId(localNoon(day)));

    assert.deepEqual(new Set(week), new Set(["2026-W38"]));
  });

  it("rolls over on Monday, not Sunday", () => {
    assert.equal(isoWeekId(localNoon("2026-09-20")), "2026-W38"); // Sunday
    assert.equal(isoWeekId(localNoon("2026-09-21")), "2026-W39"); // Monday
  });
});

describe("formatDate", () => {
  it("renders a real date rather than echoing the ISO string", () => {
    const formatted = formatDate("2026-09-16T10:00:00.000Z", "tr");

    assert.notEqual(formatted, "2026-09-16T10:00:00.000Z");
    assert.match(formatted, /2026/);
  });

  it("returns the input unchanged when it is not a date", () => {
    // Callers pass through feed data; an unparseable value must not become
    // "Invalid Date" in the rendered newsletter.
    assert.equal(formatDate("not a date", "tr"), "not a date");
    assert.equal(formatDate("", "en"), "");
  });
});

describe("daysAgo", () => {
  it("subtracts whole days from now", () => {
    const before = Date.now();
    const actual = daysAgo(7).getTime();
    const after = Date.now();

    assert.ok(actual >= before - 7 * 86_400_000);
    assert.ok(actual <= after - 7 * 86_400_000);
  });

  it("treats 0 as now", () => {
    assert.ok(Math.abs(daysAgo(0).getTime() - Date.now()) < 1000);
  });
});
