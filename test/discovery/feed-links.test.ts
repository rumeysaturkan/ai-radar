import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractFeedLinks,
  looksLikeFeedXml,
  probePaths,
  repairXml,
  resolveHref,
} from "../../src/discovery/feed-links.js";

const BASE = "https://example.com/";

function urls(html: string, base = BASE): string[] {
  return extractFeedLinks(html, base).map((link) => link.url);
}

describe("extractFeedLinks", () => {
  it("finds a standard feed link", () => {
    assert.deepEqual(
      urls('<link rel="alternate" type="application/rss+xml" href="/feed">'),
      ["https://example.com/feed"],
    );
  });

  it("does not care about attribute order", () => {
    assert.deepEqual(
      urls('<link type="application/rss+xml" rel="alternate" href="/feed">'),
      ["https://example.com/feed"],
    );
  });

  it("accepts single quotes, no quotes, uppercase and self-closing tags", () => {
    assert.deepEqual(
      urls("<link rel='alternate' type='application/rss+xml' href='/feed'/>"),
      ["https://example.com/feed"],
    );
    assert.deepEqual(
      urls("<LINK REL=alternate TYPE=application/rss+xml HREF=/feed>"),
      ["https://example.com/feed"],
    );
  });

  it("ignores an hreflang alternate, which is not a feed", () => {
    assert.deepEqual(
      urls('<link rel="alternate" hreflang="de" type="text/html" href="/de/">'),
      [],
    );
  });

  it("accepts a multi-token rel", () => {
    assert.deepEqual(
      urls('<link rel="alternate home" type="application/rss+xml" href="/feed">'),
      ["https://example.com/feed"],
    );
  });

  it("accepts atom and xml content types", () => {
    assert.equal(
      urls('<link rel="alternate" type="application/atom+xml" href="/atom">').length,
      1,
    );
    assert.equal(
      urls('<link rel="alternate" type="text/xml" href="/x">').length,
      1,
    );
  });

  it("rejects JSON Feed, which rss-parser cannot read", () => {
    assert.deepEqual(
      urls('<link rel="alternate" type="application/feed+json" href="/feed.json">'),
      [],
    );
  });

  it("ignores a feed link inside an HTML comment", () => {
    assert.deepEqual(
      urls('<!-- <link rel="alternate" type="application/rss+xml" href="/old"> -->'),
      [],
    );
  });

  it("resolves relative, protocol-relative and absolute hrefs", () => {
    const html = [
      '<link rel="alternate" type="application/rss+xml" href="/a">',
      '<link rel="alternate" type="application/rss+xml" href="//cdn.example.com/b">',
      '<link rel="alternate" type="application/rss+xml" href="https://other.com/c">',
    ].join("");

    assert.deepEqual(urls(html), [
      "https://example.com/a",
      "https://cdn.example.com/b",
      "https://other.com/c",
    ]);
  });

  it("resolves a relative href against a base that has a path", () => {
    assert.deepEqual(
      urls(
        '<link rel="alternate" type="application/rss+xml" href="../feed">',
        "https://example.com/blog/post/",
      ),
      ["https://example.com/blog/feed"],
    );
  });

  it("decodes &amp; in a query-string feed url", () => {
    assert.deepEqual(
      urls('<link rel="alternate" type="application/rss+xml" href="/?feed=rss2&amp;cat=1">'),
      ["https://example.com/?feed=rss2&cat=1"],
    );
  });

  it("collapses duplicates that differ only cosmetically", () => {
    const html = [
      '<link rel="alternate" type="application/rss+xml" href="/feed">',
      '<link rel="alternate" type="application/rss+xml" href="/feed/">',
    ].join("");

    assert.equal(urls(html).length, 1);
  });

  it("puts a comments feed last", () => {
    const html = [
      '<link rel="alternate" type="application/rss+xml" href="/comments/feed" title="Comments Feed">',
      '<link rel="alternate" type="application/rss+xml" href="/feed">',
    ].join("");

    assert.deepEqual(urls(html), [
      "https://example.com/feed",
      "https://example.com/comments/feed",
    ]);
  });

  it("returns nothing for empty or junk input", () => {
    assert.deepEqual(urls(""), []);
    assert.deepEqual(urls("<html><body>no links here</body></html>"), []);
    assert.deepEqual(urls('<link rel="alternate" type="application/rss+xml">'), []);
  });
});

describe("resolveHref", () => {
  it("returns null rather than throwing on nonsense", () => {
    assert.equal(resolveHref("::::", "not a base"), null);
  });
});

describe("probePaths", () => {
  it("builds absolute urls from the origin, not the page path", () => {
    const paths = probePaths("https://example.com/blog/some-article");

    assert.ok(paths.every((p) => p.startsWith("https://example.com/")));
    assert.ok(paths.includes("https://example.com/feed"));
  });

  it("tries the most common path first", () => {
    assert.equal(probePaths("https://example.com")[0], "https://example.com/feed");
  });

  it("includes a variant built from the first path segment", () => {
    assert.ok(
      probePaths("https://example.com/haberler/x").includes(
        "https://example.com/haberler/feed",
      ),
    );
  });

  it("covers the Blogspot and WordPress shapes", () => {
    const paths = probePaths("https://example.com");

    assert.ok(paths.includes("https://example.com/feeds/posts/default"));
    assert.ok(paths.includes("https://example.com/?feed=rss2"));
  });

  it("has no duplicates and survives a bad url", () => {
    const paths = probePaths("https://example.com");

    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(probePaths("not a url"), []);
  });
});

describe("looksLikeFeedXml", () => {
  it("accepts rss, atom and rdf", () => {
    assert.equal(looksLikeFeedXml('<?xml version="1.0"?><rss version="2.0">'), true);
    assert.equal(looksLikeFeedXml('<feed xmlns="http://www.w3.org/2005/Atom">'), true);
    assert.equal(looksLikeFeedXml("<rdf:RDF>"), true);
  });

  it("looks past a BOM, whitespace and a doctype", () => {
    assert.equal(looksLikeFeedXml('﻿  <?xml version="1.0"?>\n<rss>'), true);
    assert.equal(looksLikeFeedXml("<!DOCTYPE rss><rss>"), true);
  });

  it("rejects an HTML page returned with a 200", () => {
    assert.equal(looksLikeFeedXml("<!doctype html><html><body>Not found"), false);
    assert.equal(looksLikeFeedXml('{"version":"https://jsonfeed.org/v1"}'), false);
    assert.equal(looksLikeFeedXml(""), false);
  });
});

describe("repairXml", () => {
  it("escapes a bare ampersand", () => {
    assert.equal(repairXml("<title>Tom & Jerry</title>"), "<title>Tom &amp; Jerry</title>");
  });

  it("leaves valid entities alone", () => {
    const valid = "&amp; &#39; &#x27; &lt; &quot;";
    assert.equal(repairXml(valid), valid);
  });
});
