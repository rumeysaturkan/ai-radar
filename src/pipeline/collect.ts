import Parser from "rss-parser";
import type { Config } from "../config.js";
import { searchNews } from "../tools/search-web.js";
import type { Candidate } from "../types.js";
import { daysAgo } from "../util/date.js";
import { fetchJson } from "../util/http.js";
import { mapWithConcurrency } from "../util/pool.js";
import { isBlockedSource } from "../util/blocklist.js";
import { canonicalUrl, isHttpUrl } from "../util/url.js";
import { hashUrl } from "../store.js";
import { note, warn } from "../util/log.js";

const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": "ai-radar/1.0 (+rss)" },
});

function toCandidate(
  title: string,
  url: string,
  source: string,
  publishedAt: string | null,
  snippet: string,
  points: number | null = null,
): Candidate | null {
  const cleanTitle = title.replace(/\s+/g, " ").trim();

  if (!cleanTitle || !isHttpUrl(url)) {
    return null;
  }

  const canonical = canonicalUrl(url);

  return {
    id: hashUrl(canonical),
    title: cleanTitle,
    url: canonical,
    source,
    publishedAt,
    snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 600),
    points,
  };
}

function withinWindow(publishedAt: string | null, cutoff: Date): boolean {
  if (!publishedAt) {
    return true;
  }

  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? true : date >= cutoff;
}

async function collectFeed(
  name: string,
  url: string,
  cutoff: Date,
): Promise<Candidate[]> {
  const feed = await parser.parseURL(url);
  const candidates: Candidate[] = [];

  for (const item of feed.items) {
    const link = item.link ?? item.guid;

    if (!link || !item.title) {
      continue;
    }

    const publishedAt = item.isoDate ?? null;

    if (!withinWindow(publishedAt, cutoff)) {
      continue;
    }

    const candidate = toCandidate(
      item.title,
      link,
      name,
      publishedAt,
      item.contentSnippet ?? item.content ?? "",
    );

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

type AlgoliaHit = {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  created_at: string;
  story_text: string | null;
};

async function collectHackerNews(
  config: Config,
  cutoff: Date,
): Promise<Candidate[]> {
  const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);
  const collected: Candidate[] = [];

  for (const query of config.hackerNews.queries) {
    const params = new URLSearchParams({
      query,
      tags: "story",
      hitsPerPage: "20",
      numericFilters: `created_at_i>${cutoffSeconds},points>=${config.hackerNews.minPoints}`,
    });

    try {
      const data = await fetchJson<{ hits: AlgoliaHit[] }>(
        `https://hn.algolia.com/api/v1/search?${params.toString()}`,
      );

      for (const hit of data.hits) {
        if (!hit.title) {
          continue;
        }

        const link =
          hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;

        const candidate = toCandidate(
          hit.title,
          link,
          "Hacker News",
          hit.created_at,
          hit.story_text ?? "",
          hit.points,
        );

        if (candidate) {
          collected.push(candidate);
        }
      }
    } catch (error) {
      warn(`Hacker News "${query}" atlandı: ${describe(error)}`);
    }
  }

  return collected;
}

async function collectWebSearch(config: Config): Promise<Candidate[]> {
  if (!process.env.TAVILY_API_KEY) {
    note("TAVILY_API_KEY yok, web araması atlanıyor (RSS ile devam).");
    return [];
  }

  const collected: Candidate[] = [];

  for (const query of config.webSearch.queries) {
    try {
      const results = await searchNews(query, config.windowDays);

      for (const item of results) {
        if (isBlockedSource(item.url)) {
          continue;
        }

        const candidate = toCandidate(
          item.title,
          item.url,
          "Web araması",
          item.publishedAt,
          item.snippet,
        );

        if (candidate) {
          collected.push(candidate);
        }
      }
    } catch (error) {
      warn(`Arama "${query}" atlandı: ${describe(error)}`);
    }
  }

  return collected;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type CollectResult = {
  candidates: Candidate[];
  sourcesOk: number;
  sourcesFailed: number;
};

export async function collectCandidates(
  config: Config,
): Promise<CollectResult> {
  const cutoff = daysAgo(config.windowDays);
  let sourcesOk = 0;
  let sourcesFailed = 0;

  const feedResults = await mapWithConcurrency(
    config.feeds,
    6,
    async (feed) => {
      try {
        const items = await collectFeed(feed.name, feed.url, cutoff);
        sourcesOk += 1;
        return items;
      } catch (error) {
        sourcesFailed += 1;
        warn(`${feed.name} okunamadı: ${describe(error)}`);
        return [];
      }
    },
  );

  const candidates = feedResults.flat();

  if (config.hackerNews.enabled) {
    candidates.push(...(await collectHackerNews(config, cutoff)));
    sourcesOk += 1;
  }

  if (config.webSearch.enabled) {
    const searched = await collectWebSearch(config);

    if (searched.length > 0) {
      sourcesOk += 1;
    }

    candidates.push(...searched);
  }

  return { candidates, sourcesOk, sourcesFailed };
}
