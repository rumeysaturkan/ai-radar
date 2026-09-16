import type { Candidate, Item, ScoredCandidate, SourceStat } from "../types.js";

/**
 * Kaynak başına huniyi çıkarır: kaç aday taranmış, kaçı puanlanmaya kalmış,
 * kaçı bültene girmiş. Kaynak sağlığı raporunun ve "hangi besleme işe
 * yarıyor" sorusunun tek veri kaynağı bu.
 */
export function sourceStats(
  collected: readonly Candidate[],
  scored: readonly ScoredCandidate[],
  published: readonly Item[],
): SourceStat[] {
  const byName = new Map<string, SourceStat>();

  function bucket(name: string): SourceStat {
    let entry = byName.get(name);

    if (!entry) {
      entry = { name, scanned: 0, scored: 0, published: 0 };
      byName.set(name, entry);
    }

    return entry;
  }

  for (const candidate of collected) {
    bucket(candidate.source).scanned += 1;
  }

  for (const candidate of scored) {
    bucket(candidate.source).scored += 1;
  }

  for (const item of published) {
    bucket(item.source).published += 1;
  }

  // Verimli kaynaklar üstte; eşitlikte çok tarayan önce, sonra ada göre.
  return [...byName.values()].sort(
    (a, b) =>
      b.published - a.published ||
      b.scored - a.scored ||
      b.scanned - a.scanned ||
      a.name.localeCompare(b.name),
  );
}

/** Puan -> o puanı alan aday sayısı. Sıralamanın ne kadar ayırt ettiğini gösterir. */
export function scoreHistogram(
  scored: readonly ScoredCandidate[],
): { score: number; count: number }[] {
  const counts = new Map<number, number>();

  for (const candidate of scored) {
    counts.set(candidate.score, (counts.get(candidate.score) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((a, b) => b.score - a.score);
}
