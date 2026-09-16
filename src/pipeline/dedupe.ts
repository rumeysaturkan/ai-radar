import type { Config } from "../config.js";
import type { SeenIndex } from "../store.js";
import type { Candidate } from "../types.js";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "its", "are",
  "was", "will", "how", "why", "what", "new", "now", "out", "has", "have",
  "into", "you", "but", "not", "can", "all", "our", "their", "über",
  "ile", "ve", "bir", "bu", "için", "olarak", "daha", "gibi", "ama", "olan",
]);

function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

  return new Set(tokens);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of a) {
    if (b.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(a.size, b.size);
}

/** Aynı haberin farklı kaynaklardan gelen kopyalarını eler. */
const TITLE_MATCH_THRESHOLD = 0.72;

export type DedupeResult = {
  fresh: Candidate[];
  duplicatesDropped: number;
  alreadyPublished: number;
};

function freshness(candidate: Candidate): number {
  return candidate.publishedAt ? new Date(candidate.publishedAt).getTime() : 0;
}

/**
 * Tek bir kaynagin (ornegin gunde yuzlerce preprint ureten arXiv) havuzu
 * doldurmasini engeller: her kaynaktan kotasi kadar alinir, sonra kaynaklar
 * sirayla dolasilarak liste kurulur.
 */
function balanceBySource(
  candidates: readonly Candidate[],
  quotaFor: (source: string) => number,
  limit: number,
): Candidate[] {
  const groups = new Map<string, Candidate[]>();

  for (const candidate of candidates) {
    const bucket = groups.get(candidate.source) ?? [];
    bucket.push(candidate);
    groups.set(candidate.source, bucket);
  }

  const queues = [...groups.entries()].map(([source, bucket]) => {
    const sorted = [...bucket].sort((a, b) => {
      const byTime = freshness(b) - freshness(a);
      return byTime !== 0 ? byTime : (b.points ?? 0) - (a.points ?? 0);
    });

    return sorted.slice(0, quotaFor(source));
  });

  const balanced: Candidate[] = [];
  let depth = 0;
  let added = true;

  while (added && balanced.length < limit) {
    added = false;

    for (const queue of queues) {
      const candidate = queue[depth];

      if (!candidate) {
        continue;
      }

      balanced.push(candidate);
      added = true;

      if (balanced.length >= limit) {
        break;
      }
    }

    depth += 1;
  }

  return balanced;
}

export function dedupe(
  candidates: readonly Candidate[],
  seen: SeenIndex,
  config: Config,
): DedupeResult {
  const byId = new Map<string, Candidate>();
  let duplicatesDropped = 0;
  let alreadyPublished = 0;

  for (const candidate of candidates) {
    if (seen[candidate.id]) {
      alreadyPublished += 1;
      continue;
    }

    const existing = byId.get(candidate.id);

    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }

    duplicatesDropped += 1;

    // Ayni URL birden fazla kaynaktan geldiyse daha zengin olani tut.
    const better =
      (candidate.points ?? 0) > (existing.points ?? 0) ||
      candidate.snippet.length > existing.snippet.length;

    if (better) {
      byId.set(candidate.id, { ...candidate, source: existing.source });
    }
  }

  const unique = [...byId.values()];

  // Farkli yayin organlarinin ayni haberi: baslik benzerligiyle topla.
  const kept: { candidate: Candidate; tokens: Set<string> }[] = [];

  for (const candidate of unique) {
    const tokens = titleTokens(candidate.title);
    const twin = kept.find(
      (entry) => similarity(entry.tokens, tokens) >= TITLE_MATCH_THRESHOLD,
    );

    if (twin) {
      duplicatesDropped += 1;

      if ((candidate.points ?? 0) > (twin.candidate.points ?? 0)) {
        twin.candidate = candidate;
        twin.tokens = tokens;
      }

      continue;
    }

    kept.push({ candidate, tokens });
  }

  const quotas = new Map<string, number>();

  for (const feed of config.feeds) {
    if (feed.max !== undefined) {
      quotas.set(feed.name, feed.max);
    }
  }

  const fresh = balanceBySource(
    kept.map((entry) => entry.candidate),
    (source) => quotas.get(source) ?? config.maxPerSource,
    config.candidateLimit,
  );

  return { fresh, duplicatesDropped, alreadyPublished };
}
