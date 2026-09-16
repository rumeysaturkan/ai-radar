import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeFeed, classify, suggestMax } from "../../src/discovery/feed-health.js";
import type { ParsedFeed } from "../../src/discovery/types.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function feed(
  items: ParsedFeed["items"],
  extra: Partial<ParsedFeed> = {},
): ParsedFeed {
  return { items, ...extra };
}

function daily(count: number, startDay = 15): ParsedFeed["items"] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Story ${i}`,
    isoDate: new Date(Date.UTC(2026, 8, startDay - i)).toISOString(),
  }));
}

describe("analyzeFeed", () => {
  it("measures volume across the span the items actually cover", () => {
    // 8 items, one per day: seven days of span, so about 7-8 a week.
    const health = analyzeFeed(feed(daily(8)), NOW);

    assert.equal(health.itemCount, 8);
    assert.ok(health.itemsPerWeek > 6 && health.itemsPerWeek < 10);
  });

  it("reports how stale the newest item is", () => {
    const health = analyzeFeed(
      feed([{ title: "Old", isoDate: "2026-09-06T12:00:00.000Z" }]),
      NOW,
    );

    assert.equal(health.daysSinceLastPost, 10);
    assert.equal(health.lastPublishedAt, "2026-09-06T12:00:00.000Z");
  });

  it("does not divide by zero on a single item", () => {
    const health = analyzeFeed(feed(daily(1)), NOW);

    assert.ok(Number.isFinite(health.itemsPerWeek));
    assert.ok(health.itemsPerWeek > 0);
  });

  it("falls back to the item count when nothing is dated", () => {
    // Real and common. collect.ts keeps undated items, so such a feed is
    // usable - it just cannot be ranked on freshness.
    const health = analyzeFeed(
      feed([{ title: "A" }, { title: "B" }, { title: "C" }]),
      NOW,
    );

    assert.equal(health.itemsPerWeek, 3);
    assert.equal(health.daysSinceLastPost, null);
    assert.equal(health.lastPublishedAt, null);
  });

  it("ignores dates it cannot parse", () => {
    const health = analyzeFeed(
      feed([
        { title: "Good", isoDate: "2026-09-15T00:00:00.000Z" },
        { title: "Bad", isoDate: "sometime last tuesday" },
      ]),
      NOW,
    );

    assert.equal(health.lastPublishedAt, "2026-09-15T00:00:00.000Z");
  });

  it("prefers the language the feed declares over the guess", () => {
    const health = analyzeFeed(feed(daily(3), { language: "tr-TR" }), NOW);

    assert.equal(health.declaredLanguage, "tr");
  });

  it("caps the sample titles it hands on", () => {
    // These go to the ranking prompt, so they need a bound.
    assert.equal(analyzeFeed(feed(daily(30)), NOW).sampleTitles.length, 8);
  });

  it("handles a feed with no items at all", () => {
    const health = analyzeFeed(feed([]), NOW);

    assert.equal(health.itemCount, 0);
    assert.deepEqual(health.sampleTitles, []);
  });
});

describe("suggestMax", () => {
  it("clamps the per-feed quota into a usable range", () => {
    // Lands in preset feed.max, which dedupe applies as the source quota.
    assert.equal(suggestMax(0), 3);
    assert.equal(suggestMax(1), 3);
    assert.equal(suggestMax(7), 7);
    assert.equal(suggestMax(500), 12);
  });
});

describe("classify", () => {
  it("calls an empty feed empty", () => {
    assert.equal(classify(analyzeFeed(feed([]), NOW)), "empty");
  });

  it("calls a long-silent feed stale rather than dropping it", () => {
    // A monthly but excellent source is worth keeping, just not preselected.
    const old = analyzeFeed(
      feed([{ title: "Old", isoDate: "2026-01-01T00:00:00.000Z" }]),
      NOW,
    );

    assert.equal(classify(old), "stale");
  });

  it("accepts a feed that posted inside the window", () => {
    assert.equal(classify(analyzeFeed(feed(daily(5)), NOW)), "ok");
  });

  it("treats an undated feed as ok rather than stale", () => {
    assert.equal(classify(analyzeFeed(feed([{ title: "A" }]), NOW)), "ok");
  });
});
