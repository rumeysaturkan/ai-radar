import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateConfig } from "../src/config-validate.js";

function preset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Test",
    title: "Test Radar",
    tagline: "Haftalık test bülteni",
    language: "tr",
    audience: "Test okuyucuları",
    topics: ["bir konu"],
    categories: ["Birinci", "İkinci"],
    feeds: [{ name: "Example", url: "https://example.com/feed" }],
    ...overrides,
  };
}

function problemsOf(overrides: Record<string, unknown> = {}, id = "test"): string[] {
  return validateConfig(preset(overrides), id).problems;
}

describe("validateConfig", () => {
  it("accepts a well-formed preset", () => {
    assert.deepEqual(problemsOf(), []);
  });

  it("rejects a non-object", () => {
    assert.equal(validateConfig("nope", "test").problems.length, 1);
    assert.equal(validateConfig(null, "test").problems.length, 1);
    assert.equal(validateConfig([], "test").problems.length, 1);
  });

  it("rejects an id that would escape the presets directory", () => {
    for (const id of ["../etc", "Test", "a/b", "-lead"]) {
      assert.ok(problemsOf({}, id).length > 0, `${id} should be rejected`);
    }
  });

  it("catches a number written as a string", () => {
    const problems = problemsOf({ shortlist: "12" });

    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /shortlist.*tam sayı/);
    assert.match(problems[0]!, /tırnak/);
  });

  it("bounds the numeric fields", () => {
    assert.match(problemsOf({ minScore: 42 })[0]!, /minScore/);
    assert.match(problemsOf({ windowDays: 0 })[0]!, /windowDays/);
    assert.match(problemsOf({ shortlist: -1 })[0]!, /shortlist/);
  });

  describe("categories", () => {
    it("rejects an empty list", () => {
      assert.match(problemsOf({ categories: [] })[0]!, /categories/);
    });

    it("rejects duplicates, case-insensitively", () => {
      const problems = problemsOf({ categories: ["Model", "model"] });

      assert.equal(problems.length, 1);
      assert.match(problems[0]!, /tekrar eden/);
    });

    it("rejects an unusably long list", () => {
      const many = Array.from({ length: 12 }, (_, i) => `Kategori ${i}`);
      assert.match(problemsOf({ categories: many })[0]!, /en fazla 8/);
    });

    it("rejects empty strings inside the list", () => {
      assert.match(problemsOf({ categories: ["Bir", "  "] })[0]!, /categories/);
    });
  });

  describe("feeds", () => {
    it("rejects a url that is not http(s)", () => {
      const problems = problemsOf({
        feeds: [{ name: "Bad", url: "javascript:alert(1)" }],
      });

      assert.equal(problems.length, 1);
      assert.match(problems[0]!, /feeds\[0\]\.url/);
    });

    it("rejects duplicate feed names", () => {
      const problems = problemsOf({
        feeds: [
          { name: "Blog", url: "https://a.com/feed" },
          { name: "Blog", url: "https://b.com/feed" },
        ],
      });

      assert.equal(problems.length, 1);
      assert.match(problems[0]!, /benzersiz/);
    });

    it("reports the index of the offending feed", () => {
      const problems = problemsOf({
        feeds: [
          { name: "Good", url: "https://a.com/feed" },
          { name: "", url: "https://b.com/feed" },
        ],
      });

      assert.match(problems[0]!, /feeds\[1\]\.name/);
    });

    it("bounds a per-feed max", () => {
      assert.match(
        problemsOf({
          feeds: [{ name: "A", url: "https://a.com/f", max: 0 }],
        })[0]!,
        /feeds\[0\]\.max/,
      );
    });
  });

  it("requires at least one way of finding content", () => {
    const problems = problemsOf({ feeds: [] });

    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /Hiç kaynak yok/);
  });

  it("accepts a feed-less preset that searches instead", () => {
    assert.deepEqual(
      problemsOf({
        feeds: [],
        webSearch: { enabled: true, queries: ["kahve sektörü haberleri"] },
      }),
      [],
    );
  });

  it("requires siteUrl to be absolute when set", () => {
    assert.deepEqual(problemsOf({ siteUrl: "" }), []);
    assert.match(problemsOf({ siteUrl: "example.com" })[0]!, /siteUrl/);
    assert.deepEqual(problemsOf({ siteUrl: "https://radar.example.com" }), []);
  });

  it("checks the reasoning effort against the known values", () => {
    assert.deepEqual(problemsOf({ reasoningEffort: "low" }), []);
    assert.match(problemsOf({ reasoningEffort: "maximum" })[0]!, /reasoningEffort/);
  });

  it("collects every problem instead of stopping at the first", () => {
    const problems = problemsOf({
      shortlist: "12",
      minScore: 99,
      categories: ["A", "a"],
      feeds: [{ name: "X", url: "ftp://x.com/feed" }],
    });

    assert.ok(problems.length >= 4, `expected several problems, got ${problems.length}`);
  });

  it("warns about unknown keys without failing", () => {
    const { problems, warnings } = validateConfig(
      preset({ shortlst: 12 }),
      "test",
    );

    assert.deepEqual(problems, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /shortlst/);
  });
});
