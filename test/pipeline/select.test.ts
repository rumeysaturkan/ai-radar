import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rank, select } from "../../src/pipeline/select.js";
import type { ScoredCandidate } from "../../src/types.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");

let seq = 0;

function cand(
  overrides: Partial<ScoredCandidate> & { url: string },
): ScoredCandidate {
  seq += 1;
  return {
    id: `id${String(seq).padStart(4, "0")}`,
    title: `title ${seq}`,
    source: "Source",
    publishedAt: "2026-09-15T00:00:00.000Z",
    snippet: "",
    points: null,
    score: 8,
    reason: "",
    category: "Birinci",
    ...overrides,
  };
}

function domains(items: readonly ScoredCandidate[]): string[] {
  return items.map((item) => new URL(item.url).hostname);
}

describe("rank", () => {
  it("puts higher scores first", () => {
    const ranked = rank(
      [
        cand({ url: "https://a.com/1", score: 6 }),
        cand({ url: "https://b.com/1", score: 9 }),
        cand({ url: "https://c.com/1", score: 7 }),
      ],
      NOW,
    );

    assert.deepEqual(ranked.map((r) => r.score), [9, 7, 6]);
  });

  it("breaks score ties by freshness, in whole days", () => {
    const ranked = rank(
      [
        cand({ url: "https://old.com/1", publishedAt: "2026-09-10T00:00:00.000Z" }),
        cand({ url: "https://new.com/1", publishedAt: "2026-09-16T00:00:00.000Z" }),
      ],
      NOW,
    );

    assert.deepEqual(domains(ranked), ["new.com", "old.com"]);
  });

  it("ignores sub-day timestamp differences", () => {
    const sameDay = [
      cand({
        id: "zzzz",
        url: "https://arxiv.org/abs/1",
        publishedAt: "2026-09-15T00:00:00.000Z",
      }),
      cand({
        id: "aaaa",
        url: "https://arxiv.org/abs/2",
        publishedAt: "2026-09-15T23:59:00.000Z",
      }),
    ];

    assert.deepEqual(
      rank(sameDay, NOW).map((r) => r.id),
      ["aaaa", "zzzz"],
    );
  });

  it("prefers more Hacker News points when score and day match", () => {
    const ranked = rank(
      [
        cand({ url: "https://a.com/1", points: 90 }),
        cand({ url: "https://b.com/1", points: 400 }),
      ],
      NOW,
    );

    assert.deepEqual(ranked.map((r) => r.points), [400, 90]);
  });

  it("sinks undated items below dated ones", () => {
    const ranked = rank(
      [
        cand({ url: "https://undated.com/1", publishedAt: null }),
        cand({ url: "https://dated.com/1", publishedAt: "2026-08-01T00:00:00.000Z" }),
      ],
      NOW,
    );

    assert.deepEqual(domains(ranked), ["dated.com", "undated.com"]);
  });

  it("resolves remaining ties by content id, not input order", () => {
    const items = [
      cand({ id: "ffff", url: "https://a.com/1" }),
      cand({ id: "0000", url: "https://b.com/1" }),
      cand({ id: "7777", url: "https://c.com/1" }),
    ];

    assert.deepEqual(rank(items, NOW).map((r) => r.id), ["0000", "7777", "ffff"]);
    assert.deepEqual(
      rank([...items].reverse(), NOW).map((r) => r.id),
      ["0000", "7777", "ffff"],
    );
  });

  it("does not mutate its input", () => {
    const items = [
      cand({ url: "https://a.com/1", score: 3 }),
      cand({ url: "https://b.com/1", score: 9 }),
    ];
    const before = items.map((i) => i.id);

    rank(items, NOW);

    assert.deepEqual(items.map((i) => i.id), before);
  });
});

describe("select", () => {
  it("caps how many items one publisher can contribute", () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) =>
        cand({ url: `https://openai.com/${i}` }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        cand({ url: `https://other${i}.com/x` }),
      ),
    ];

    const picked = select(items, { minScore: 6, shortlist: 12, now: NOW });
    const fromOpenAi = picked.filter((p) => p.url.includes("openai.com"));

    assert.equal(picked.length, 12);
    assert.equal(fromOpenAi.length, 3);
  });

  it("groups subdomains of one publisher into a single bucket", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) =>
        cand({ url: `https://finance.yahoo.com/${i}` }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        cand({ url: `https://sg.finance.yahoo.com/${i}` }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        cand({ url: `https://other${i}.com/x` }),
      ),
    ];

    const picked = select(items, { minScore: 6, shortlist: 12, now: NOW });

    assert.equal(picked.filter((p) => p.url.includes("yahoo.com")).length, 3);
  });

  it("fills the shortlist from capped publishers rather than running short", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      cand({ url: `https://only.com/${i}` }),
    );

    const picked = select(items, { minScore: 6, shortlist: 8, now: NOW });

    assert.equal(picked.length, 8);
  });

  it("spreads the overflow evenly when diversity runs out", () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => cand({ url: `https://one.com/${i}` })),
      ...Array.from({ length: 8 }, (_, i) => cand({ url: `https://two.com/${i}` })),
    ];

    const picked = select(items, { minScore: 6, shortlist: 12, now: NOW });
    const one = picked.filter((p) => p.url.includes("one.com")).length;
    const two = picked.filter((p) => p.url.includes("two.com")).length;

    assert.equal(picked.length, 12);
    assert.equal(one, 6);
    assert.equal(two, 6);
  });

  it("drops anything below the score threshold", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) =>
        cand({ url: `https://good${i}.com/x`, score: 8 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        cand({ url: `https://weak${i}.com/x`, score: 3 }),
      ),
    ];

    const picked = select(items, { minScore: 6, shortlist: 12, now: NOW });

    assert.equal(picked.length, 6);
    assert.ok(picked.every((p) => p.score >= 6));
  });

  it("relaxes the threshold rather than publishing a near-empty issue", () => {
    const items = [
      cand({ url: "https://a.com/x", score: 9 }),
      cand({ url: "https://b.com/x", score: 8 }),
      ...Array.from({ length: 10 }, (_, i) =>
        cand({ url: `https://weak${i}.com/x`, score: 2 }),
      ),
    ];

    const picked = select(items, { minScore: 6, shortlist: 12, now: NOW });

    assert.equal(picked.length, 5);
    assert.deepEqual(picked.slice(0, 2).map((p) => p.score), [9, 8]);
  });

  it("returns everything when there is less than a shortlist of it", () => {
    const items = [
      cand({ url: "https://a.com/x", score: 9 }),
      cand({ url: "https://b.com/x", score: 8 }),
    ];

    assert.equal(select(items, { minScore: 6, shortlist: 12, now: NOW }).length, 2);
  });

  it("handles an empty candidate list", () => {
    assert.deepEqual(select([], { minScore: 6, shortlist: 12, now: NOW }), []);
  });

  it("is independent of input order", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      cand({
        url: `https://site${i % 7}.com/${i}`,
        score: 6 + (i % 4),
      }),
    );

    const forward = select(items, { minScore: 6, shortlist: 12, now: NOW });
    const backward = select([...items].reverse(), {
      minScore: 6,
      shortlist: 12,
      now: NOW,
    });

    assert.deepEqual(forward.map((p) => p.id), backward.map((p) => p.id));
  });

  it("honours an explicit per-domain cap", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      cand({ url: `https://one.com/${i}` }),
    ).concat(
      Array.from({ length: 10 }, (_, i) => cand({ url: `https://two.com/${i}` })),
    );

    const picked = select(items, {
      minScore: 6,
      shortlist: 12,
      maxPerDomain: 1,
      now: NOW,
    });

    assert.equal(picked.length, 12);
  });
});
