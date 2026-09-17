import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SAFE_ID } from "../../src/config-validate.js";
import {
  buildPreset,
  checkPreset,
  slugifyId,
  uniquifyNames,
} from "../../src/discovery/preset-build.js";
import { sanitizeProfile, truncateWords } from "../../src/discovery/profile.js";
import { applyRatings } from "../../src/discovery/rank.js";
import type {
  DiscoveryRequest,
  FeedFinding,
  RankedFeed,
} from "../../src/discovery/types.js";

function finding(domain: string, name = domain): FeedFinding {
  return {
    site: {
      name,
      url: `https://${domain}`,
      origin: `https://${domain}`,
      why: "",
      via: "search",
    },
    feed: { url: `https://${domain}/feed`, title: name, via: "link-tag" },
    health: {
      itemCount: 10,
      lastPublishedAt: "2026-09-15T00:00:00.000Z",
      daysSinceLastPost: 1,
      itemsPerWeek: 7,
      suggestedMax: 7,
      declaredLanguage: "tr",
      detectedLanguage: "tr",
      languageConfidence: 0.8,
      feedTitle: name,
      sampleTitles: ["Bir başlık", "İkinci başlık"],
    },
    status: "ok",
    error: null,
    requestCount: 2,
  };
}

function ranked(domain: string, name = domain): RankedFeed {
  return {
    ...finding(domain, name),
    credibility: 8,
    verdict: "keep",
    reason: "",
    suggestedName: name,
  };
}

const request: DiscoveryRequest = {
  topic: "kahve sektörü",
  language: "tr",
  windowDays: 7,
  maxFeeds: 12,
  strictLanguage: false,
};

describe("slugifyId", () => {
  it("folds Turkish letters to ASCII", () => {
    assert.equal(slugifyId("kahve sektörü"), "kahve-sektoru");
    assert.equal(slugifyId("Yazılım Geliştirme"), "yazilim-gelistirme");
    assert.equal(slugifyId("Güvenlik & Şifreleme"), "guvenlik-sifreleme");
  });

  it("handles the dotted capital I", () => {
    const slug = slugifyId("İSTANBUL Kahve");

    assert.equal(slug, "istanbul-kahve");
    assert.ok(!slug.includes("̇"), "combining dot leaked into the id");
  });

  it("always produces something the config loader will accept", () => {
    for (const input of [
      "kahve sektörü",
      "Game Industry!",
      "  spaced  out  ",
      "2026 trends",
      "çok---fazla___ayraç",
      "ÜÇÜNCÜ",
    ]) {
      assert.match(slugifyId(input), SAFE_ID, `${input} produced an invalid id`);
    }
  });

  it("does not start with a digit", () => {
    assert.match(slugifyId("2026 trends"), /^x-/);
  });

  it("returns empty for input with nothing usable", () => {
    assert.equal(slugifyId("!!!"), "");
    assert.equal(slugifyId(""), "");
  });
});

describe("uniquifyNames", () => {
  it("leaves distinct names alone", () => {
    assert.deepEqual(
      uniquifyNames(["A", "B"], ["https://a.com/f", "https://b.com/f"]),
      ["A", "B"],
    );
  });

  it("disambiguates a collision with the domain", () => {
    assert.deepEqual(
      uniquifyNames(["Blog", "Blog"], ["https://a.com/f", "https://b.com/f"]),
      ["Blog", "Blog (b.com)"],
    );
  });

  it("falls back to the domain for a blank name", () => {
    assert.deepEqual(uniquifyNames([""], ["https://example.com/feed"]), [
      "example.com",
    ]);
  });

  it("produces a unique name for every entry", () => {
    const names = uniquifyNames(
      ["Blog", "Blog", "Blog", "Blog"],
      ["https://a.com/f", "https://a.com/g", "https://a.com/h", "https://a.com/i"],
    );

    assert.equal(new Set(names).size, 4);
  });
});

describe("buildPreset", () => {
  const profile = {
    name: "Kahve",
    title: "Kahve Radar",
    tagline: "Haftalık kahve bülteni",
    audience: "Kavurmacılar",
    topics: ["yeşil kahve fiyatları", "kavurma ekipmanı"],
    categories: ["Piyasa", "Ekipman", "Ticaret"],
    hackerNewsQueries: [],
    webSearchQueries: ["kahve sektörü haberleri"],
  };

  it("produces a preset the loader accepts", () => {
    const config = buildPreset({
      id: "kahve",
      language: "tr",
      profile,
      accepted: [ranked("a.com", "A"), ranked("b.com", "B")],
    });

    assert.deepEqual(checkPreset(config), []);
  });

  it("survives a round trip through JSON", () => {
    const config = buildPreset({
      id: "kahve",
      language: "tr",
      profile,
      accepted: [ranked("a.com", "A")],
    });

    assert.deepEqual(
      checkPreset(JSON.parse(JSON.stringify(config)) as typeof config),
      [],
    );
  });

  it("gives a busy feed its own quota", () => {
    const busy = ranked("arxiv.org", "arXiv");
    busy.health!.suggestedMax = 5;

    const config = buildPreset({
      id: "x",
      language: "tr",
      profile,
      accepted: [busy],
    });

    assert.equal(config.feeds[0]!.max, 5);
  });

  it("turns Hacker News off when the profile asks for no queries", () => {
    const config = buildPreset({
      id: "kahve",
      language: "tr",
      profile,
      accepted: [ranked("a.com")],
    });

    assert.equal(config.hackerNews.enabled, false);
  });

  it("never emits two feeds with the same name", () => {
    const config = buildPreset({
      id: "x",
      language: "tr",
      profile,
      accepted: [ranked("a.com", "Blog"), ranked("b.com", "Blog")],
    });

    assert.deepEqual(checkPreset(config), []);
    assert.equal(new Set(config.feeds.map((f) => f.name)).size, 2);
  });
});

describe("sanitizeProfile", () => {
  const base = {
    name: "X",
    title: "X Radar",
    tagline: "t",
    audience: "a",
    topics: ["one"],
    categories: ["Bir", "İki", "Üç"],
    hackerNewsQueries: [],
    webSearchQueries: [],
  };

  it("caps and deduplicates categories", () => {
    const profile = sanitizeProfile(
      {
        ...base,
        categories: ["Bir", "bir", "BİR", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi"],
      },
      request,
    );

    assert.ok(profile.categories.length <= 6);
    assert.equal(
      new Set(profile.categories.map((c) => c.toLocaleLowerCase("tr"))).size,
      profile.categories.length,
    );
  });

  it("pads when the model returns too few categories", () => {
    const profile = sanitizeProfile({ ...base, categories: ["Tek"] }, request);

    assert.ok(profile.categories.length >= 3);
    assert.equal(new Set(profile.categories).size, profile.categories.length);
  });

  it("drops empty strings", () => {
    const profile = sanitizeProfile(
      { ...base, categories: ["Bir", "   ", "", "İki", "Üç"], topics: ["", "ok"] },
      request,
    );

    assert.ok(profile.categories.every((c) => c.trim().length > 0));
    assert.ok(profile.topics.every((t) => t.trim().length > 0));
  });

  it("falls back to the topic when everything is blank", () => {
    const profile = sanitizeProfile(
      { ...base, name: "  ", title: "", tagline: "", audience: "", topics: [] },
      request,
    );

    assert.ok(profile.name.length > 0);
    assert.ok(profile.topics.length > 0);
  });
});

describe("applyRatings", () => {
  it("skips a rating pointing past the end of the list", () => {
    const result = applyRatings(
      [finding("a.com")],
      [
        { index: 0, credibility: 8, verdict: "keep", reason: "", suggestedName: "A" },
        { index: 99, credibility: 9, verdict: "keep", reason: "", suggestedName: "B" },
      ],
    );

    assert.equal(result.length, 1);
  });

  it("clamps credibility and coerces an unknown verdict", () => {
    const [entry] = applyRatings(
      [finding("a.com")],
      [{ index: 0, credibility: 99, verdict: "definitely", reason: "", suggestedName: "A" }],
    );

    assert.equal(entry!.credibility, 10);
    assert.equal(entry!.verdict, "maybe");
  });

  it("falls back through feed title to domain for a blank name", () => {
    const [entry] = applyRatings(
      [finding("example.com", "Example Blog")],
      [{ index: 0, credibility: 5, verdict: "keep", reason: "", suggestedName: "  " }],
    );

    assert.equal(entry!.suggestedName, "Example Blog");
  });
});

describe("truncateWords", () => {
  it("leaves short text alone", () => {
    assert.equal(truncateWords("Kahve Üretimi", 28), "Kahve Üretimi");
  });

  it("stops at a word boundary instead of mid-word", () => {
    const cut = truncateWords("Küresel Kahve Ticareti ve Piyasalar", 28);

    assert.ok(cut.length <= 28);
    assert.ok(!cut.endsWith("Pi"), `cut mid-word: ${cut}`);
    assert.equal(cut, "Küresel Kahve Ticareti ve");
  });

  it("drops a trailing conjunction's punctuation", () => {
    assert.ok(!truncateWords("Tadım, Puanlama, Ödüller ve Yarışmalar", 24).endsWith(","));
  });

  it("falls back to a hard cut for one very long word", () => {
    const cut = truncateWords("Donaudampfschifffahrtsgesellschaftskapitaen", 20);

    assert.equal(cut.length, 20);
  });

  it("collapses whitespace", () => {
    assert.equal(truncateWords("  a   b  ", 40), "a b");
  });

  it("handles empty input", () => {
    assert.equal(truncateWords("", 10), "");
  });
});
