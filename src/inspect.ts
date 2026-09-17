import { COLUMNS } from "./columns.js";
import { ui } from "./i18n.js";
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

  console.log(
    color.bold(ui({ tr: "  Puan dağılımı", en: "  Score distribution" })),
  );
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
        ui(
          {
            tr: "     en yüksek puan {score}, bu puanda {count} aday var.",
            en: "     top score {score}, shared by {count} candidates.",
          },
          { score: top.score, count: top.count },
        ),
      ),
    );
  }
}

function printSources(issue: Issue): void {
  const sources = issue.sources ?? [];

  if (sources.length === 0) {
    console.log(
      color.dim(
        ui({
          tr: "  Bu sayı kaynak istatistiği olmadan üretilmiş.",
          en: "  This issue was produced without per-source statistics.",
        }),
      ),
    );
    return;
  }

  console.log(color.bold(ui({ tr: "  Kaynak hunisi", en: "  Source funnel" })));
  console.log("");
  console.log(
    color.dim(
      `  ${pad(ui(COLUMNS.source), 26)}${padLeft(ui(COLUMNS.scanned), 9)}` +
        `${padLeft(ui(COLUMNS.scored), 11)}${padLeft(ui(COLUMNS.published), 11)}` +
        `${padLeft(ui(COLUMNS.rate), 8)}`,
    ),
  );

  for (const source of sources) {
    const rate =
      source.scored === 0
        ? "—"
        : `${((source.published / source.scored) * 100).toFixed(0)}%`;

    console.log(
      `  ${pad(source.name, 26)}${padLeft(source.scanned, 9)}${padLeft(source.scored, 11)}${padLeft(source.published, 11)}${padLeft(rate, 8)}`,
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

  console.log(
    color.bold(
      ui({
        tr: "  Yayınlananların domain dağılımı",
        en: "  Domain spread of what was published",
      }),
    ),
  );
  console.log("");

  for (const [domain, count] of rows) {
    const flag = count > Math.max(2, Math.ceil(issue.items.length / 4));
    console.log(
      `  ${pad(domain, 34)}${padLeft(count, 4)}` +
        (flag ? color.yellow(ui({ tr: "   ← baskın", en: "   ← dominant" })) : ""),
    );
  }
}

async function main(): Promise<void> {
  const [presetId, issueId] = process.argv.slice(2);

  if (!presetId) {
    console.error(
      ui({
        tr: "\n  Kullanım: npm run inspect <alan> [sayı]\n",
        en: "\n  Usage: npm run inspect <domain> [issue]\n",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const issues = await listIssues(presetId);

  if (issues.length === 0) {
    console.error(
      ui(
        {
          tr: '\n  "{id}" alanında arşivlenmiş sayı yok.\n',
          en: '\n  There are no archived issues for "{id}".\n',
        },
        { id: presetId },
      ),
    );
    process.exitCode = 1;
    return;
  }

  const issue = issueId
    ? issues.find((entry) => entry.id === issueId)
    : issues[0];

  if (!issue) {
    const known = issues.map((entry) => entry.id).join(", ");
    console.error(
      ui(
        {
          tr: '\n  "{id}" diye bir sayı yok. Arşivdekiler: {known}\n',
          en: '\n  There is no issue "{id}". The archive holds: {known}\n',
        },
        { id: issueId ?? "", known },
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(
    color.bold(
      color.cyan(
        `  ${issue.title} — ` +
          ui(
            { tr: "Sayı {number}", en: "Issue {number}" },
            { number: issue.number },
          ) +
          ` (${issue.id})`,
      ),
    ),
  );
  console.log(
    color.dim(
      ui(
        {
          tr:
            "  {collected} aday tarandı · {fresh} yeni · " +
            "{scored} puanlandı · {published} yayınlandı",
          en:
            "  {collected} scanned · {fresh} new · " +
            "{scored} scored · {published} published",
        },
        issue.stats,
      ),
    ),
  );
  console.log("");

  if (issue.candidates && issue.candidates.length > 0) {
    printHistogram(issue.candidates);
  } else {
    console.log(
      color.dim(
        ui({
          tr: "  Bu sayı aday listesi olmadan üretilmiş; puan dağılımı gösterilemiyor.",
          en: "  This issue kept no candidate list; the score distribution cannot be shown.",
        }),
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
    `\n  ${ui({ tr: "Hata", en: "Error" })}: ` +
      `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
