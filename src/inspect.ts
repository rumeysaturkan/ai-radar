import { scoreHistogram } from "./pipeline/stats.js";
import { listIssues } from "./store.js";
import type { Issue, ScoredCandidate } from "./types.js";
import { color } from "./util/log.js";
import { domainOf } from "./util/url.js";

function bar(count: number, max: number, width = 32): string {
  const filled = max === 0 ? 0 : Math.max(1, Math.round((count / max) * width));
  return "█".repeat(filled);
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

function padLeft(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function printHistogram(candidates: readonly ScoredCandidate[]): void {
  const histogram = scoreHistogram(candidates);
  const max = Math.max(...histogram.map((row) => row.count), 0);

  console.log(color.bold("  Puan dağılımı"));
  console.log("");

  for (const row of histogram) {
    console.log(
      `  ${padLeft(row.score, 3)}  ${padLeft(row.count, 4)}  ${color.cyan(bar(row.count, max))}`,
    );
  }

  const top = histogram[0];

  if (top) {
    console.log("");
    console.log(
      color.dim(
        `     en yüksek puan ${top.score}, bu puanda ${top.count} aday var.`,
      ),
    );
  }
}

function printSources(issue: Issue): void {
  const sources = issue.sources ?? [];

  if (sources.length === 0) {
    console.log(color.dim("  Bu sayı kaynak istatistiği olmadan üretilmiş."));
    return;
  }

  console.log(color.bold("  Kaynak hunisi"));
  console.log("");
  console.log(
    color.dim(`  ${pad("kaynak", 26)}${padLeft("taranan", 9)}${padLeft("puanlanan", 11)}${padLeft("yayın", 7)}${padLeft("oran", 8)}`),
  );

  for (const source of sources) {
    const rate =
      source.scored === 0
        ? "—"
        : `${((source.published / source.scored) * 100).toFixed(0)}%`;

    console.log(
      `  ${pad(source.name, 26)}${padLeft(source.scanned, 9)}${padLeft(source.scored, 11)}${padLeft(source.published, 7)}${padLeft(rate, 8)}`,
    );
  }
}

function printPublishedDomains(issue: Issue): void {
  const counts = new Map<string, number>();

  for (const item of issue.items) {
    const domain = domainOf(item.url);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  console.log(color.bold("  Yayınlananların domain dağılımı"));
  console.log("");

  for (const [domain, count] of rows) {
    const flag = count > Math.max(2, Math.ceil(issue.items.length / 4));
    console.log(
      `  ${pad(domain, 34)}${padLeft(count, 4)}` +
        (flag ? color.yellow("   ← baskın") : ""),
    );
  }
}

async function main(): Promise<void> {
  const [presetId, issueId] = process.argv.slice(2);

  if (!presetId) {
    console.error("\n  Kullanım: npm run inspect <alan> [sayı]\n");
    process.exitCode = 1;
    return;
  }

  const issues = await listIssues(presetId);

  if (issues.length === 0) {
    console.error(`\n  "${presetId}" alanında arşivlenmiş sayı yok.\n`);
    process.exitCode = 1;
    return;
  }

  const issue = issueId
    ? issues.find((entry) => entry.id === issueId)
    : issues[0];

  if (!issue) {
    const known = issues.map((entry) => entry.id).join(", ");
    console.error(`\n  "${issueId}" diye bir sayı yok. Arşivdekiler: ${known}\n`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(
    color.bold(color.cyan(`  ${issue.title} — Sayı ${issue.number} (${issue.id})`)),
  );
  console.log(
    color.dim(
      `  ${issue.stats.collected} aday tarandı · ${issue.stats.fresh} yeni · ` +
        `${issue.stats.scored} puanlandı · ${issue.stats.published} yayınlandı`,
    ),
  );
  console.log("");

  if (issue.candidates && issue.candidates.length > 0) {
    printHistogram(issue.candidates);
  } else {
    console.log(
      color.dim(
        "  Bu sayı aday listesi olmadan üretilmiş; puan dağılımı gösterilemiyor.",
      ),
    );
  }

  console.log("");
  printSources(issue);
  console.log("");
  printPublishedDomains(issue);
  console.log("");
}

main().catch((error: unknown) => {
  console.error(
    `\n  Hata: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
