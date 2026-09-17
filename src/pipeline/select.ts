import type { ScoredCandidate } from "../types.js";
import { registrableDomain } from "../util/url.js";

export const MIN_ITEMS = 5;

export type SelectOptions = {
  minScore: number;
  shortlist: number;
  maxPerDomain?: number;
  now?: Date;
};

const DAY_MS = 86_400_000;

function ageInDays(candidate: ScoredCandidate, now: number): number {
  if (!candidate.publishedAt) {
    return Number.MAX_SAFE_INTEGER;
  }

  const published = new Date(candidate.publishedAt).getTime();

  if (Number.isNaN(published)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(0, Math.floor((now - published) / DAY_MS));
}

function compare(a: ScoredCandidate, b: ScoredCandidate, now: number): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  const ageA = ageInDays(a, now);
  const ageB = ageInDays(b, now);

  if (ageA !== ageB) {
    return ageA - ageB;
  }

  const pointsA = a.points ?? 0;
  const pointsB = b.points ?? 0;

  if (pointsA !== pointsB) {
    return pointsB - pointsA;
  }

  return a.id.localeCompare(b.id);
}

export function rank(
  scored: readonly ScoredCandidate[],
  now: Date = new Date(),
): ScoredCandidate[] {
  const timestamp = now.getTime();
  return [...scored].sort((a, b) => compare(a, b, timestamp));
}

export function select(
  scored: readonly ScoredCandidate[],
  options: SelectOptions,
): ScoredCandidate[] {
  const ranked = rank(scored, options.now ?? new Date());
  const strong = ranked.filter((item) => item.score >= options.minScore);

  const enough = strong.length >= MIN_ITEMS;
  const pool = enough ? strong : ranked;
  const limit = enough
    ? options.shortlist
    : Math.min(options.shortlist, MIN_ITEMS);

  const cap =
    options.maxPerDomain ?? Math.max(2, Math.ceil(options.shortlist / 4));

  const picked: ScoredCandidate[] = [];
  const perDomain = new Map<string, number>();
  const remaining = [...pool];

  for (let currentCap = cap; picked.length < limit; currentCap += 1) {
    let progressed = false;
    let index = 0;

    while (index < remaining.length && picked.length < limit) {
      const candidate = remaining[index]!;
      const domain = registrableDomain(candidate.url);
      const used = perDomain.get(domain) ?? 0;

      if (used < currentCap) {
        picked.push(candidate);
        perDomain.set(domain, used + 1);
        remaining.splice(index, 1);
        progressed = true;
      } else {
        index += 1;
      }
    }

    if (!progressed) {
      break;
    }
  }

  return rank(picked, options.now ?? new Date());
}
