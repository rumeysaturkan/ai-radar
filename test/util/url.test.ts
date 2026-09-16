import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalUrl, domainOf } from "../../src/util/url.js";

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
