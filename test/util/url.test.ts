import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalUrl, domainOf, isHttpUrl, safeHref } from "../../src/util/url.js";

// Feed content is untrusted input, and becomes more so once sources are
// discovered automatically rather than hand-curated.
describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    assert.equal(isHttpUrl("https://example.com/a"), true);
    assert.equal(isHttpUrl("http://example.com/a"), true);
  });

  it("rejects schemes that only look like http", () => {
    // The previous check was url.startsWith("http"), which let these through.
    assert.equal(isHttpUrl("httpx://example.com"), false);
    assert.equal(isHttpUrl("http-evil://example.com"), false);
  });

  it("rejects executable and local schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      assert.equal(isHttpUrl(url), false, `${url} should be rejected`);
    }
  });

  it("rejects anything that will not parse", () => {
    assert.equal(isHttpUrl(""), false);
    assert.equal(isHttpUrl("/relative/path"), false);
    assert.equal(isHttpUrl("not a url"), false);
  });
});

describe("safeHref", () => {
  it("returns the url when the scheme is safe", () => {
    assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  });

  it("returns null rather than an unsafe href", () => {
    // Escaping does not stop a javascript: scheme from running on click, so
    // the only safe answer is to not build the link at all.
    assert.equal(safeHref("javascript:alert(1)"), null);
    assert.equal(safeHref("data:text/html,x"), null);
    assert.equal(safeHref(""), null);
  });
});

// canonicalUrl is the basis of deduplication: two addresses for the same story
// must collapse to one string, because that string is hashed into the candidate
// id and looked up in seen.json.
describe("canonicalUrl", () => {
  it("collapses the many addresses of one article", () => {
    const variants = [
      "https://example.com/post",
      "https://www.example.com/post",
      "http://example.com/post",
      "https://example.com/post/",
      "https://example.com/post#comments",
      "https://example.com/post?utm_source=newsletter",
      "https://EXAMPLE.com/post",
    ].map(canonicalUrl);

    assert.deepEqual(new Set(variants), new Set(["https://example.com/post"]));
  });

  it("drops every known tracking parameter", () => {
    const tracked =
      "https://example.com/p?utm_source=a&utm_medium=b&utm_campaign=c" +
      "&utm_term=d&utm_content=e&ref=f&source=g&fbclid=h&gclid=i&mc_cid=j&mc_eid=k";

    assert.equal(canonicalUrl(tracked), "https://example.com/p");
  });

  it("keeps parameters that identify the content", () => {
    // Dropping these would merge genuinely different pages into one id.
    assert.equal(canonicalUrl("https://example.com/p?id=5"), "https://example.com/p?id=5");
    assert.equal(
      canonicalUrl("https://example.com/feed?utm_source=x&format=rss"),
      "https://example.com/feed?format=rss",
    );
  });

  it("keeps the root path but trims trailing slashes elsewhere", () => {
    assert.equal(canonicalUrl("https://example.com/"), "https://example.com/");
    assert.equal(canonicalUrl("https://example.com"), "https://example.com/");
    assert.equal(canonicalUrl("https://example.com/a///"), "https://example.com/a");
  });

  it("strips only a leading www, not any subdomain", () => {
    assert.equal(canonicalUrl("https://blog.example.com/x"), "https://blog.example.com/x");
    assert.equal(canonicalUrl("https://www.blog.example.com/x"), "https://blog.example.com/x");
  });

  it("preserves path case, which is often significant", () => {
    assert.equal(canonicalUrl("https://example.com/Post"), "https://example.com/Post");
  });

  it("falls back to a trimmed lowercase string when the URL will not parse", () => {
    assert.equal(canonicalUrl("  Not A URL  "), "not a url");
    assert.equal(canonicalUrl(""), "");
  });
});

describe("domainOf", () => {
  it("returns the host without a leading www", () => {
    assert.equal(domainOf("https://www.example.com/a/b?c=d"), "example.com");
    assert.equal(domainOf("https://example.com"), "example.com");
  });

  it("keeps meaningful subdomains", () => {
    // The diversity cap groups by domain, so arxiv.org and blog.arxiv.org
    // should not silently merge.
    assert.equal(domainOf("https://blog.example.com/x"), "blog.example.com");
  });

  it("returns the input when it will not parse", () => {
    assert.equal(domainOf("not a url"), "not a url");
  });
});
