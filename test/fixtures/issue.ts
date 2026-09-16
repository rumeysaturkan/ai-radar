import type { Config } from "../../src/config.js";
import type { Issue, Item } from "../../src/types.js";

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    id: "test",
    name: "Test",
    title: "Test Radar",
    tagline: "Haftalık test bülteni",
    language: "tr",
    siteUrl: "",
    audience: "Test okuyucuları",
    topics: ["bir konu"],
    categories: ["Birinci", "İkinci"],
    windowDays: 7,
    candidateLimit: 160,
    maxPerSource: 12,
    shortlist: 12,
    minScore: 6,
    models: { scorer: "gpt-5-mini", writer: "gpt-5.1" },
    feeds: [],
    hackerNews: { enabled: false, minPoints: 80, queries: [] },
    webSearch: { enabled: false, queries: [] },
    ...overrides,
  };
}

export function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "aaaaaaaaaaaa",
    title: "Bir haber başlığı",
    url: "https://example.com/story",
    source: "Example",
    publishedAt: "2026-09-15T08:00:00.000Z",
    snippet: "kısa özet",
    points: null,
    score: 8,
    reason: "somut bir gelişme",
    category: "Birinci",
    tldr: "Ne olduğunun iki cümlelik anlatımı.",
    whyItMatters: "Okuyucu için pratik sonucu bu.",
    tags: ["etiket"],
    ...overrides,
  };
}

export function makeIssue(items: Item[], overrides: Partial<Issue> = {}): Issue {
  return {
    id: "2026-W38",
    number: 1,
    title: "Test Radar",
    tagline: "Haftalık test bülteni",
    generatedAt: "2026-09-16T10:00:00.000Z",
    periodStart: "2026-09-09T10:00:00.000Z",
    periodEnd: "2026-09-16T10:00:00.000Z",
    intro: "Bu haftanın ana hattı.",
    highlightId: items[0]?.id ?? "",
    items,
    stats: { collected: 100, fresh: 40, scored: 40, published: items.length },
    usage: { inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.01 },
    ...overrides,
  };
}
