import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findFeedForSite } from "../../src/discovery/find-feed.js";
import type { FindFeedDeps } from "../../src/discovery/find-feed.js";
import type { FetchedPage } from "../../src/discovery/net.js";
import type { CandidateSite, ParsedFeed } from "../../src/discovery/types.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");

const site: CandidateSite = {
  name: "Example",
  url: "https://example.com/some-article",
  origin: "https://example.com",
  why: "",
  via: "search",
};

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Example Feed</title>
<item><title>A story</title><pubDate>Mon, 15 Sep 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const HTML_WITH_LINK = `<html><head>
<link rel="alternate" type="application/rss+xml" href="/feed">
</head><body></body></html>`;

const HTML_NO_LINK = "<html><head></head><body>nothing here</body></html>";

function page(body: string, status = 200, url = ""): FetchedPage {
  return {
    requestedUrl: url,
    finalUrl: url,
    status,
    contentType: "text/html",
    body,
    truncated: false,
  };
}

function fakeDeps(
  routes: Record<string, FetchedPage | (() => FetchedPage)>,
  fallback: FetchedPage = page("not found", 404),
): { deps: FindFeedDeps; requested: string[] } {
  const requested: string[] = [];

  const deps: FindFeedDeps = {
    now: () => NOW,
    parseFeed: async (xml: string): Promise<ParsedFeed> => {
      if (!xml.includes("<rss") && !xml.includes("<feed")) {
        throw new Error("not xml");
      }
      return {
        title: "Example Feed",
        items: [{ title: "A story", isoDate: "2026-09-15T00:00:00.000Z" }],
      };
    },
    fetchPage: async (url: string) => {
      requested.push(url);
      const route = routes[url];

      if (!route) {
        return { ...fallback, requestedUrl: url, finalUrl: url };
      }

      const resolved = typeof route === "function" ? route() : route;
      return { ...resolved, requestedUrl: url, finalUrl: resolved.finalUrl || url };
    },
  };

  return { deps, requested };
}

describe("findFeedForSite", () => {
  it("uses a declared feed link and never probes", () => {
    const { deps, requested } = fakeDeps({
      "https://example.com": page(HTML_WITH_LINK),
      "https://example.com/feed": page(RSS),
    });

    return findFeedForSite(site, deps).then((finding) => {
      assert.equal(finding.status, "ok");
      assert.equal(finding.feed?.url, "https://example.com/feed");
      assert.equal(finding.feed?.via, "link-tag");
      assert.equal(finding.requestCount, 2);
      assert.deepEqual(requested, ["https://example.com", "https://example.com/feed"]);
    });
  });

  it("falls back to probing when the page declares nothing", async () => {
    const { deps } = fakeDeps({
      "https://example.com": page(HTML_NO_LINK),
      "https://example.com/rss": page(RSS),
    });

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.status, "ok");
    assert.equal(finding.feed?.url, "https://example.com/rss");
    assert.equal(finding.feed?.via, "probe");
  });

  it("probes anyway when the homepage blocks us", async () => {
    const { deps } = fakeDeps({
      "https://example.com": page("blocked", 403),
      "https://example.com/feed": page(RSS),
    });

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.status, "ok");
    assert.equal(finding.feed?.url, "https://example.com/feed");
  });

  it("probes anyway when fetching the homepage throws", async () => {
    const deps: FindFeedDeps = {
      now: () => NOW,
      parseFeed: async () => ({
        items: [{ title: "A", isoDate: "2026-09-15T00:00:00.000Z" }],
      }),
      fetchPage: async (url: string) => {
        if (url === "https://example.com") {
          throw new Error("ECONNRESET");
        }
        return url === "https://example.com/feed"
          ? page(RSS, 200, url)
          : page("no", 404, url);
      },
    };

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.status, "ok");
  });

  it("rejects a soft 404 that returns HTML with a 200", async () => {
    const { deps } = fakeDeps({
      "https://example.com": page(HTML_NO_LINK),
      "https://example.com/feed": page("<!doctype html><html>homepage</html>"),
      "https://example.com/rss": page(RSS),
    });

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.feed?.url, "https://example.com/rss");
  });

  it("retries a parse failure once with repaired XML", async () => {
    let parseAttempts = 0;

    const deps: FindFeedDeps = {
      now: () => NOW,
      parseFeed: async (xml: string) => {
        parseAttempts += 1;
        if (xml.includes("Tom & Jerry")) {
          throw new Error("bare ampersand");
        }
        return { items: [{ title: "ok", isoDate: "2026-09-15T00:00:00.000Z" }] };
      },
      fetchPage: async (url: string) =>
        url === "https://example.com/feed"
          ? page("<rss><channel><title>Tom & Jerry</title></channel></rss>", 200, url)
          : page(HTML_NO_LINK, 200, url),
    };

    const finding = await findFeedForSite(site, deps);

    assert.equal(parseAttempts, 2, "should try again with repaired XML");
    assert.equal(finding.status, "ok");
  });

  it("keeps looking when a feed parses but is empty", async () => {
    const deps: FindFeedDeps = {
      now: () => NOW,
      parseFeed: async (xml: string) => ({
        items: xml.includes("empty")
          ? []
          : [{ title: "A", isoDate: "2026-09-15T00:00:00.000Z" }],
      }),
      fetchPage: async (url: string) => {
        if (url === "https://example.com/feed") {
          return page("<rss>empty</rss>", 200, url);
        }
        if (url === "https://example.com/rss") {
          return page(RSS, 200, url);
        }
        return page(HTML_NO_LINK, 200, url);
      },
    };

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.feed?.url, "https://example.com/rss");
  });

  it("gives up with a bounded number of requests", async () => {
    const { deps, requested } = fakeDeps({
      "https://example.com": page(HTML_NO_LINK),
    });

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.status, "no-feed");
    assert.equal(finding.feed, null);
    assert.ok(finding.requestCount <= 12, `made ${finding.requestCount} requests`);
    assert.equal(requested.length, finding.requestCount);
  });

  it("reports an unreachable site distinctly from one with no feed", async () => {
    const deps: FindFeedDeps = {
      now: () => NOW,
      parseFeed: async () => ({ items: [] }),
      fetchPage: async () => {
        throw new Error("ENOTFOUND");
      },
    };

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.feed, null);
    assert.match(finding.error ?? "", /ENOTFOUND/);
  });

  it("resolves relative links against the redirect target", async () => {
    const { deps } = fakeDeps({
      "https://example.com": {
        ...page('<link rel="alternate" type="application/rss+xml" href="feed.xml">'),
        finalUrl: "https://example.com/blog/",
      },
      "https://example.com/blog/feed.xml": page(RSS),
    });

    const finding = await findFeedForSite(site, deps);

    assert.equal(finding.feed?.url, "https://example.com/blog/feed.xml");
  });
});
