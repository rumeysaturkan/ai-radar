import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seenFromIssues } from "../src/store.js";
import { makeIssue, makeItem } from "./fixtures/issue.js";

const NOW = new Date("2026-09-17T10:00:00.000Z");

describe("seenFromIssues", () => {
  it("indexes every published item by id", () => {
    const issue = makeIssue([
      makeItem({ id: "aaa", url: "https://example.com/a", title: "A" }),
      makeItem({ id: "bbb", url: "https://example.com/b", title: "B" }),
    ]);

    const seen = seenFromIssues([issue], NOW);

    assert.deepEqual(Object.keys(seen).sort(), ["aaa", "bbb"]);
    assert.equal(seen["aaa"]?.url, "https://example.com/a");
    assert.equal(seen["bbb"]?.title, "B");
  });

  it("dates an item by the issue that first carried it", () => {
    const older = makeIssue([makeItem({ id: "aaa" })], {
      id: "2026-W36",
      generatedAt: "2026-09-02T10:00:00.000Z",
    });
    const newer = makeIssue([makeItem({ id: "aaa" })], {
      id: "2026-W38",
      generatedAt: "2026-09-16T10:00:00.000Z",
    });

    const seen = seenFromIssues([newer, older], NOW);

    assert.equal(seen["aaa"]?.firstSeen, "2026-09-02T10:00:00.000Z");
  });

  it("drops items older than the retention window", () => {
    const ancient = makeIssue([makeItem({ id: "old" })], {
      id: "2025-W38",
      generatedAt: "2025-09-16T10:00:00.000Z",
    });
    const recent = makeIssue([makeItem({ id: "new" })], {
      id: "2026-W38",
      generatedAt: "2026-09-16T10:00:00.000Z",
    });

    const seen = seenFromIssues([ancient, recent], NOW);

    assert.deepEqual(Object.keys(seen), ["new"]);
  });

  it("returns an empty index when there are no issues", () => {
    assert.deepEqual(seenFromIssues([], NOW), {});
  });
});
