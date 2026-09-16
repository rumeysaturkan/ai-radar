import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderFeed,
  renderIndexHtml,
  renderIssueHtml,
  renderMarkdown,
  resolveSiteUrl,
} from "../../src/pipeline/render.js";
import { makeConfig, makeIssue, makeItem } from "../fixtures/issue.js";

// These assert invariants rather than exact markup. A golden-file snapshot of a
// 480-line document that embeds a full stylesheet breaks on every CSS tweak,
// and a test nobody trusts gets deleted.
describe("renderIssueHtml", () => {
  it("declares the configured language, not a hardcoded one", () => {
    const items = [makeItem()];

    assert.match(renderIssueHtml(makeConfig(), makeIssue(items)), /<html lang="tr">/);
    assert.match(
      renderIssueHtml(makeConfig({ language: "en" }), makeIssue(items)),
      /<html lang="en">/,
    );
  });

  it("links every item exactly once", () => {
    const items = [
      makeItem({ id: "a", url: "https://example.com/one" }),
      makeItem({ id: "b", url: "https://example.com/two", category: "İkinci" }),
    ];
    const html = renderIssueHtml(makeConfig(), makeIssue(items, { highlightId: "a" }));

    for (const item of items) {
      assert.equal(
        html.split(`href="${item.url}"`).length - 1,
        1,
        `${item.url} should appear as an href exactly once`,
      );
    }
  });

  it("escapes markup coming from a feed", () => {
    const html = renderIssueHtml(
      makeConfig(),
      makeIssue([
        makeItem({
          title: '<script>alert("xss")</script>',
          tldr: "<img src=x onerror=alert(1)>",
        }),
      ]),
    );

    assert.ok(!html.includes("<script>alert"), "title markup must be escaped");
    assert.ok(!html.includes("<img src=x"), "summary markup must be escaped");
    assert.match(html, /&lt;script&gt;/);
  });

  it("refuses to build a link for an unsafe scheme", () => {
    const html = renderIssueHtml(
      makeConfig(),
      makeIssue([makeItem({ title: "Zararlı", url: "javascript:alert(1)" })]),
    );

    assert.ok(!html.includes("javascript:"), "must not emit a javascript: href");
    // The story is still reported, just without a clickable link.
    assert.match(html, /Zararlı/);
  });

  it("keeps a category heading out of the page when nothing landed in it", () => {
    const html = renderIssueHtml(
      makeConfig(),
      makeIssue([makeItem({ category: "Birinci" })], { highlightId: "" }),
    );

    assert.match(html, /Birinci/);
    assert.ok(!html.includes("İkinci"), "empty categories should be skipped");
  });
});

describe("renderMarkdown", () => {
  it("links safe urls and plain-texts unsafe ones", () => {
    const safe = renderMarkdown(
      makeConfig(),
      makeIssue([makeItem({ title: "Güvenli", url: "https://example.com/x" })]),
    );
    assert.match(safe, /\*\*\[Güvenli\]\(https:\/\/example\.com\/x\)\*\*/);

    const unsafe = renderMarkdown(
      makeConfig(),
      makeIssue([makeItem({ title: "Zararlı", url: "javascript:alert(1)" })]),
    );
    assert.ok(!unsafe.includes("javascript:"));
    assert.match(unsafe, /\*\*Zararlı\*\*/);
  });

  it("strips brackets that would break the link syntax", () => {
    const md = renderMarkdown(
      makeConfig(),
      makeIssue([makeItem({ title: "A [b] c", url: "https://example.com/x" })]),
    );

    assert.match(md, /\*\*\[A b c\]\(https:\/\/example\.com\/x\)\*\*/);
  });
});

describe("resolveSiteUrl", () => {
  it("returns null for an unset or unusable site url", () => {
    // RSS needs absolute links; a relative one produces a feed no reader accepts.
    assert.equal(resolveSiteUrl(makeConfig({ siteUrl: "" })), null);
    assert.equal(resolveSiteUrl(makeConfig({ siteUrl: "   " })), null);
    assert.equal(resolveSiteUrl(makeConfig({ siteUrl: "example.com" })), null);
  });

  it("normalises a usable one by trimming trailing slashes", () => {
    assert.equal(
      resolveSiteUrl(makeConfig({ siteUrl: "https://radar.example.com//" })),
      "https://radar.example.com",
    );
  });
});

describe("renderFeed", () => {
  it("emits only absolute links", () => {
    const xml = renderFeed(
      makeConfig({ id: "ai" }),
      [makeIssue([makeItem()])],
      "https://radar.example.com",
    );

    const links = [...xml.matchAll(/<link>([^<]*)<\/link>/g)].map((m) => m[1] ?? "");

    assert.ok(links.length > 0);
    for (const link of links) {
      assert.match(link, /^https:\/\//, `"${link}" must be absolute`);
    }
  });

  it("carries the configured language", () => {
    const xml = renderFeed(
      makeConfig({ language: "en" }),
      [makeIssue([makeItem()])],
      "https://radar.example.com",
    );

    assert.match(xml, /<language>en<\/language>/);
  });
});

describe("renderIndexHtml", () => {
  it("renders an empty archive without throwing", () => {
    const html = renderIndexHtml(makeConfig(), []);
    assert.match(html, /<html lang="tr">/);
  });
});

describe("language switching", () => {
  it("renders the chrome in the configured language", () => {
    // config.language used to control only the date format and <html lang>;
    // every visible label was hardcoded Turkish.
    const items = [makeItem()];
    const tr = renderIssueHtml(makeConfig({ language: "tr" }), makeIssue(items));
    const en = renderIssueHtml(
      makeConfig({ language: "en", categories: ["Birinci", "İkinci"] }),
      makeIssue(items),
    );

    assert.match(tr, /Neden önemli:/);
    assert.match(tr, /Haftanın öne çıkanı/);

    assert.match(en, /Why it matters:/);
    assert.match(en, /This week's pick/);
    assert.ok(!en.includes("Neden önemli"), "Turkish chrome leaked into the English page");
  });

  it("switches the markdown chrome too", () => {
    const items = [makeItem()];

    assert.match(renderMarkdown(makeConfig({ language: "tr" }), makeIssue(items)), /Neden önemli/);
    assert.match(
      renderMarkdown(makeConfig({ language: "en" }), makeIssue(items)),
      /Why it matters/,
    );
  });
});
