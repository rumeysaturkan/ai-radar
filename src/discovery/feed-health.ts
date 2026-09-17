import { detectLanguage } from "./language.js";
import type { FeedHealth, FeedStatus, ParsedFeed } from "./types.js";

const DAY_MS = 86_400_000;

const STALE_DAYS = 90;

const SAMPLE_LIMIT = 8;

function normalizeLanguageTag(tag: string | undefined): string | null {
  if (!tag) {
    return null;
  }

  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return base && /^[a-z]{2,3}$/.test(base) ? base : null;
}

function itemDate(item: ParsedFeed["items"][number]): number | null {
  const raw = item.isoDate ?? item.pubDate;

  if (!raw) {
    return null;
  }

  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
}

export function suggestMax(itemsPerWeek: number): number {
  return Math.min(12, Math.max(3, Math.ceil(itemsPerWeek)));
}

export function analyzeFeed(feed: ParsedFeed, now: Date): FeedHealth {
  const items = feed.items ?? [];
  const dated = items
    .map(itemDate)
    .filter((time): time is number => time !== null)
    .sort((a, b) => b - a);

  const newest = dated[0] ?? null;
  const oldest = dated.at(-1) ?? null;

  let itemsPerWeek: number;

  if (dated.length >= 2 && newest !== null && oldest !== null) {
    const spanDays = Math.max((newest - oldest) / DAY_MS, 1);
    itemsPerWeek = (dated.length / spanDays) * 7;
  } else {
    itemsPerWeek = items.length;
  }

  const sampleTitles = items
    .map((item) => item.title?.replace(/\s+/g, " ").trim())
    .filter((title): title is string => Boolean(title))
    .slice(0, SAMPLE_LIMIT);

  const sampleText = [
    ...sampleTitles,
    ...items
      .slice(0, SAMPLE_LIMIT)
      .map((item) => item.contentSnippet ?? "")
      .filter(Boolean),
  ].join(" ");

  const detected = detectLanguage(sampleText);

  return {
    itemCount: items.length,
    lastPublishedAt: newest === null ? null : new Date(newest).toISOString(),
    daysSinceLastPost:
      newest === null
        ? null
        : Math.max(0, Math.floor((now.getTime() - newest) / DAY_MS)),
    itemsPerWeek: Number(itemsPerWeek.toFixed(2)),
    suggestedMax: suggestMax(itemsPerWeek),
    declaredLanguage: normalizeLanguageTag(feed.language),
    detectedLanguage: detected.language === "unknown" ? null : detected.language,
    languageConfidence: detected.confidence,
    feedTitle: feed.title?.replace(/\s+/g, " ").trim() ?? null,
    sampleTitles,
  };
}

export function classify(health: FeedHealth): FeedStatus {
  if (health.itemCount === 0) {
    return "empty";
  }

  if (health.daysSinceLastPost !== null && health.daysSinceLastPost > STALE_DAYS) {
    return "stale";
  }

  return "ok";
}
