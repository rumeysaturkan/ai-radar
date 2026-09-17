import assert from "node:assert/strict";
import { describe, it } from "node:test";
process.env.RADAR_LANG = "en";

const { aggregate, verdictFor } = await import("../src/health-stats.js");
import type { SourceStat } from "../src/types.js";

function stat(
  name: string,
  scanned: number,
  scored: number,
  published: number,
): SourceStat {
  return { name, scanned, scored, published };
}

describe("aggregate", () => {
  it("sums a source across issues", () => {
    const health = aggregate([
      [stat("A", 10, 5, 2)],
      [stat("A", 20, 8, 1)],
    ]);

    assert.equal(health.length, 1);
    assert.deepEqual(
      { ...health[0]!, hitRate: Number(health[0]!.hitRate.toFixed(4)) },
      {
        name: "A",
        scanned: 30,
        scored: 13,
        published: 3,
        hitRate: 0.2308,
        issuesWithPublication: 2,
        issuesSeen: 2,
      },
    );
  });

  it("counts only the issues a source actually reached", () => {
    const health = aggregate([
      [stat("A", 10, 5, 1), stat("B", 10, 5, 0)],
      [stat("A", 10, 5, 1)],
    ]);

    const b = health.find((entry) => entry.name === "B")!;

    assert.equal(b.issuesSeen, 1);
    assert.equal(b.issuesWithPublication, 0);
  });

  it("ranks by what actually got published", () => {
    const health = aggregate([
      [stat("Noisy", 500, 40, 1), stat("Quiet", 8, 8, 5)],
    ]);

    assert.deepEqual(health.map((entry) => entry.name), ["Quiet", "Noisy"]);
  });

  it("does not divide by zero for a source that was never scored", () => {
    const health = aggregate([[stat("A", 50, 0, 0)]]);

    assert.equal(health[0]!.hitRate, 0);
  });

  it("returns nothing for no issues", () => {
    assert.deepEqual(aggregate([]), []);
  });
});

describe("verdictFor", () => {
  const base = {
    name: "A",
    scanned: 0,
    scored: 0,
    published: 0,
    hitRate: 0,
    issuesWithPublication: 0,
    issuesSeen: 5,
  };

  it("stays quiet until there is enough history", () => {
    assert.equal(
      verdictFor({ ...base, scanned: 200, issuesSeen: 1 }, 1),
      null,
    );
    assert.equal(verdictFor({ ...base, scanned: 200 }, 2), null);
  });

  it("flags a source that has never produced a published story", () => {
    const verdict = verdictFor({ ...base, scanned: 200, scored: 40 }, 5);

    assert.match(verdict ?? "", /consider dropping it/);
  });

  it("flags a high-volume source with a negligible hit rate", () => {
    const verdict = verdictFor(
      { ...base, scanned: 600, scored: 200, published: 2, hitRate: 0.01 },
      5,
    );

    assert.match(verdict ?? "", /lower its max quota/);
  });

  it("says nothing about a source that is doing its job", () => {
    assert.equal(
      verdictFor(
        { ...base, scanned: 40, scored: 20, published: 6, hitRate: 0.3 },
        5,
      ),
      null,
    );
  });

  it("does not flag a low-volume source for being quiet", () => {
    assert.equal(
      verdictFor({ ...base, scanned: 20, scored: 10, published: 0 }, 5),
      null,
    );
  });
});
