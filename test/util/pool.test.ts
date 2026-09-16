import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapWithConcurrency } from "../../src/util/pool.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("returns results in input order, not completion order", () => {
    // The pipeline indexes into these results, so out-of-order output would
    // silently attach the wrong summary to the wrong story.
    const items = [30, 10, 20, 0];

    return mapWithConcurrency(items, 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    }).then((results) => {
      assert.deepEqual(results, [30, 10, 20, 0]);
    });
  });

  it("passes the index of each item to the worker", async () => {
    const seen = await mapWithConcurrency(["a", "b", "c"], 3, async (item, index) => {
      return `${index}:${item}`;
    });

    assert.deepEqual(seen, ["0:a", "1:b", "2:c"]);
  });

  it("never runs more than `limit` workers at once", async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });

    assert.equal(peak, 3);
  });

  it("actually runs work in parallel", async () => {
    // Guards against the pool degenerating into a sequential loop.
    const gate = deferred<void>();
    let started = 0;

    const run = mapWithConcurrency([1, 2, 3], 3, async () => {
      started += 1;
      await gate.promise;
    });

    await Promise.resolve();
    assert.equal(started, 3, "all three should start before any finishes");

    gate.resolve();
    await run;
  });

  it("handles an empty list without spawning workers", async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => "x"), []);
  });

  it("caps the worker count at the item count", async () => {
    let peak = 0;
    let active = 0;

    await mapWithConcurrency([1, 2], 10, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });

    assert.equal(peak, 2);
  });

  it("propagates a worker rejection", async () => {
    await assert.rejects(
      () =>
        mapWithConcurrency([1, 2, 3], 2, async (n) => {
          if (n === 2) {
            throw new Error("boom");
          }
          return n;
        }),
      /boom/,
    );
  });
});
