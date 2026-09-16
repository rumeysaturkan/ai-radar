import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreHistogram, sourceStats } from "../../src/pipeline/stats.js";
import type { Candidate, Item, ScoredCandidate } from "../../src/types.js";
import { makeItem } from "../fixtures/issue.js";

function candidate(source: string, id: string): Candidate {
  return {
    id,
    title: `title ${id}`,
    url: `https://example.com/${id}`,
    source,
    publishedAt: null,
    snippet: "",
    points: null,
  };
}

function scoredCandidate(source: string, id: string, score: number): ScoredCandidate {
  return { ...candidate(source, id), score, reason: "", category: "Birinci" };
}

describe("sourceStats", () => {
  it("counts each stage of the funnel per source", () => {
    const collected = [
      candidate("A", "1"),
      candidate("A", "2"),
      candidate("A", "3"),
      candidate("B", "4"),
    ];
    const scored = [scoredCandidate("A", "1", 8), scoredCandidate("B", "4", 9)];
    const published: Item[] = [makeItem({ id: "4", source: "B" })];

    assert.deepEqual(sourceStats(collected, scored, published), [
      { name: "B", scanned: 1, scored: 1, published: 1 },
      { name: "A", scanned: 3, scored: 1, published: 0 },
    ]);
  });

  it("keeps a source that was scanned but never published", () => {
    // This row is the whole point: a feed producing volume and no results is
    // exactly what the health report needs to surface.
    const stats = sourceStats([candidate("Noisy", "1")], [], []);

    assert.deepEqual(stats, [
      { name: "Noisy", scanned: 1, scored: 0, published: 0 },
    ]);
  });

  it("ranks by published, then scored, then scanned", () => {
    const collected = [
      candidate("Low", "1"),
      candidate("Low", "2"),
      candidate("Mid", "3"),
      candidate("Top", "4"),
    ];
    const scored = [
      scoredCandidate("Low", "1", 5),
      scoredCandidate("Mid", "3", 7),
      scoredCandidate("Top", "4", 9),
    ];
    const published = [makeItem({ id: "4", source: "Top" })];

    assert.deepEqual(
      sourceStats(collected, scored, published).map((s) => s.name),
      ["Top", "Low", "Mid"],
    );
  });

  it("returns nothing for an empty run", () => {
    assert.deepEqual(sourceStats([], [], []), []);
  });
});

describe("scoreHistogram", () => {
  it("counts candidates per score, highest first", () => {
    const scored = [
      scoredCandidate("A", "1", 8),
      scoredCandidate("A", "2", 8),
      scoredCandidate("B", "3", 9),
      scoredCandidate("B", "4", 3),
    ];

    assert.deepEqual(scoreHistogram(scored), [
      { score: 9, count: 1 },
      { score: 8, count: 2 },
      { score: 3, count: 1 },
    ]);
  });

  it("exposes the clustering that makes ranking arbitrary", () => {
    // 30 candidates, 28 of them tied at 8: whichever 12 reach the newsletter
    // are chosen by the tie-break, not by the score.
    const scored = [
      ...Array.from({ length: 28 }, (_, i) => scoredCandidate("A", `t${i}`, 8)),
      scoredCandidate("B", "hi", 9),
      scoredCandidate("B", "lo", 2),
    ];

    const top = scoreHistogram(scored).find((row) => row.count > 12);
    assert.ok(top, "a bucket larger than the shortlist means score is not deciding");
    assert.equal(top.score, 8);
  });

  it("handles an empty list", () => {
    assert.deepEqual(scoreHistogram([]), []);
  });
});
