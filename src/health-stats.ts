import type { SourceStat } from "./types.js";

export type SourceHealth = {
  name: string;
  scanned: number;
  scored: number;
  published: number;
  hitRate: number;
  issuesWithPublication: number;
  issuesSeen: number;
};

export function aggregate(
  perIssue: readonly (readonly SourceStat[])[],
): SourceHealth[] {
  const totals = new Map<string, SourceHealth>();

  for (const issue of perIssue) {
    for (const stat of issue) {
      let entry = totals.get(stat.name);

      if (!entry) {
        entry = {
          name: stat.name,
          scanned: 0,
          scored: 0,
          published: 0,
          hitRate: 0,
          issuesWithPublication: 0,
          issuesSeen: 0,
        };
        totals.set(stat.name, entry);
      }

      entry.scanned += stat.scanned;
      entry.scored += stat.scored;
      entry.published += stat.published;
      entry.issuesSeen += 1;

      if (stat.published > 0) {
        entry.issuesWithPublication += 1;
      }
    }
  }

  for (const entry of totals.values()) {
    entry.hitRate = entry.scored === 0 ? 0 : entry.published / entry.scored;
  }

  return [...totals.values()].sort(
    (a, b) => b.published - a.published || b.hitRate - a.hitRate || a.name.localeCompare(b.name),
  );
}

export function verdictFor(entry: SourceHealth, issueCount: number): string | null {
  if (issueCount < 3 || entry.issuesSeen < 3) {
    return null;
  }

  if (entry.published === 0 && entry.scanned >= 30) {
    return "hiç yayına girmedi — çıkarmayı düşün";
  }

  if (entry.scanned >= 100 && entry.hitRate < 0.02) {
    return "çok tarama, az sonuç — max kotasını düşür";
  }

  return null;
}
