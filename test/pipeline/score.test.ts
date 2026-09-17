import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreCandidates, type ScoreDeps } from "../../src/pipeline/score.js";
import type { Candidate } from "../../src/types.js";
import { makeConfig } from "../fixtures/issue.js";

function candidate(id: string, title = `title ${id}`): Candidate {
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    source: "Example",
    publishedAt: "2026-09-15T00:00:00.000Z",
    snippet: "snippet",
    points: null,
  };
}

type Rating = {
  index: number;
  score: number;
  category: string;
  reason: string;
};

type Payload = { index: number; title: string; snippet: string };

function parsePayload(user: string): Payload[] {
  return JSON.parse(user.replace(/^Candidates:\n/, "")) as Payload[];
}

function fakeStructured(
  handler: (request: { system: string; user: string }) => unknown,
): ScoreDeps["structured"] {
  return (async (request: { system: string; user: string }) =>
    handler(request)) as ScoreDeps["structured"];
}

function fakeModel(reply: (payload: Payload[]) => Rating[]): {
  deps: ScoreDeps;
  calls: { system: string; user: string }[];
} {
  const calls: { system: string; user: string }[] = [];

  return {
    calls,
    deps: {
      structured: fakeStructured((request) => {
        calls.push(request);
        return { ratings: reply(parsePayload(request.user)) };
      }),
    },
  };
}

const config = makeConfig();

describe("scoreCandidates", () => {
  it("never tells the model which source an item came from", async () => {
    const { deps, calls } = fakeModel((payload) =>
      payload.map((p) => ({
        index: p.index,
        score: 8,
        category: "Birinci",
        reason: "",
      })),
    );

    await scoreCandidates(config, [candidate("a")], { seed: "s" }, deps);

    assert.equal(calls.length, 1);
    assert.ok(!calls[0]!.user.includes("Example"), "payload leaked the source");
    assert.ok(!calls[0]!.user.includes("source"));
  });

  it("clamps a score the model pushes out of range", async () => {
    const { deps } = fakeModel((payload) =>
      payload.map((p) => ({
        index: p.index,
        score: p.title.includes("high") ? 42 : -3,
        category: "Birinci",
        reason: "",
      })),
    );

    const scored = await scoreCandidates(
      config,
      [candidate("a", "high one"), candidate("b", "low one")],
      { seed: "s" },
      deps,
    );

    assert.deepEqual(
      scored.map((s) => s.score).sort((x, y) => y - x),
      [10, 0],
    );
  });

  it("ignores a rating pointing at an index that does not exist", async () => {
    const { deps } = fakeModel(() => [
      { index: 0, score: 8, category: "Birinci", reason: "" },
      { index: 99, score: 10, category: "Birinci", reason: "" },
    ]);

    const scored = await scoreCandidates(config, [candidate("a")], { seed: "s" }, deps);

    assert.equal(scored.length, 1);
  });

  it("drops a batch that fails rather than the whole run", async () => {
    let call = 0;
    const deps: ScoreDeps = {
      structured: fakeStructured((request) => {
        call += 1;

        if (call === 1) {
          throw new Error("rate limited");
        }

        return {
          ratings: parsePayload(request.user).map((p) => ({
            index: p.index,
            score: 8,
            category: "Birinci",
            reason: "",
          })),
        };
      }),
    };

    const candidates = Array.from({ length: 45 }, (_, i) => candidate(`c${i}`));
    const scored = await scoreCandidates(config, candidates, { seed: "s" }, deps);

    assert.ok(scored.length > 0 && scored.length < 45);
  });

  it("returns candidates sorted by score", async () => {
    const { deps } = fakeModel((payload) =>
      payload.map((p) => ({
        index: p.index,
        score: p.title.includes("good") ? 10 : 2,
        category: "Birinci",
        reason: "",
      })),
    );

    const scored = await scoreCandidates(
      config,
      [candidate("a", "weak"), candidate("b", "good one"), candidate("c", "weak")],
      { seed: "s" },
      deps,
    );

    assert.equal(scored[0]!.score, 10);
    assert.ok(scored.at(-1)!.score < 10);
  });

  it("gives the same result for the same seed", async () => {
    const run = async () => {
      const { deps } = fakeModel((payload) =>
        payload.map((p) => ({
          index: p.index,
          score: 8,
          category: "Birinci",
          reason: "",
        })),
      );
      const candidates = Array.from({ length: 40 }, (_, i) => candidate(`c${i}`));
      return (
        await scoreCandidates(config, candidates, { seed: "2026-W38" }, deps)
      ).map((c) => c.id);
    };

    assert.deepEqual(await run(), await run());
  });
});
