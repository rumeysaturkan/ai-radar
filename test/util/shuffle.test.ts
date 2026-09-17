import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shuffle } from "../../src/util/shuffle.js";

const items = Array.from({ length: 60 }, (_, i) => i);

describe("shuffle", () => {
  it("is deterministic for a given seed", () => {
    assert.deepEqual(shuffle(items, "2026-W38"), shuffle(items, "2026-W38"));
  });

  it("produces a different order for a different seed", () => {
    assert.notDeepEqual(shuffle(items, "2026-W38"), shuffle(items, "2026-W39"));
  });

  it("keeps every element exactly once", () => {
    const shuffled = shuffle(items, "seed");

    assert.equal(shuffled.length, items.length);
    assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  });

  it("actually reorders", () => {
    assert.notDeepEqual(shuffle(items, "2026-W38"), items);
  });

  it("does not mutate its input", () => {
    const original = [...items];
    shuffle(items, "seed");
    assert.deepEqual(items, original);
  });

  it("handles empty and single-element lists", () => {
    assert.deepEqual(shuffle([], "seed"), []);
    assert.deepEqual(shuffle(["only"], "seed"), ["only"]);
  });

  it("spreads early elements across the list", () => {
    const shuffled = shuffle(items, "2026-W38");
    const firstTen = new Set(items.slice(0, 10));
    const landedInFirstBatch = shuffled
      .slice(0, 10)
      .filter((value) => firstTen.has(value)).length;

    assert.ok(
      landedInFirstBatch < 8,
      `expected the first ten inputs to spread, ${landedInFirstBatch} stayed put`,
    );
  });
});
