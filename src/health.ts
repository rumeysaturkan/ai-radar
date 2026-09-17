import { loadConfig } from "./config.js";
import { aggregate, verdictFor } from "./health-stats.js";
import { ui } from "./i18n.js";
import { COLUMNS } from "./columns.js";
import { listIssues } from "./store.js";
import { color } from "./util/log.js";

async function main(): Promise<void> {
  const [presetId] = process.argv.slice(2);

  if (!presetId) {
    console.error(
      ui({
        tr: "\n  Kullanım: npm run health <alan>\n",
        en: "\n  Usage: npm run health <domain>\n",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig(presetId);
  const issues = await listIssues(presetId);
  const withStats = issues.filter((issue) => issue.sources && issue.sources.length > 0);

  console.log("");
  console.log(
    color.bold(
      color.cyan(
        `  ${config.title} — ` +
          ui({ tr: "kaynak sağlığı", en: "source health" }),
      ),
    ),
  );

  if (withStats.length === 0) {
    console.log(
      color.dim(
        ui(
          {
            tr: "  {count} sayı var ama hiçbiri kaynak istatistiği içermiyor.",
            en: "  There are {count} issues, but none carries per-source statistics.",
          },
          { count: issues.length },
        ),
      ),
    );
    console.log(
      color.dim(
        ui({
          tr: "  Bir sonraki `npm start` çalıştırması kaydedecek.\n",
          en: "  The next `npm start` run will record them.\n",
        }),
      ),
    );
    return;
  }

  console.log(
    color.dim(
      ui(
        { tr: "  {count} sayı üzerinden", en: "  across {count} issues" },
        { count: withStats.length },
      ) +
        (withStats.length < 3
          ? ui({
              tr: " (öneri için en az 3 sayı gerekli)",
              en: " (a recommendation needs at least 3)",
            })
          : ""),
    ),
  );
  console.log("");

  const health = aggregate(withStats.map((issue) => issue.sources ?? []));
  const configured = new Set(config.feeds.map((feed) => feed.name));

  console.log(
    color.dim(
      `  ${ui(COLUMNS.source).padEnd(26)}${ui(COLUMNS.scanned).padStart(9)}` +
        `${ui(COLUMNS.scored).padStart(11)}${ui(COLUMNS.published).padStart(11)}` +
        `${ui(COLUMNS.rate).padStart(8)}`,
    ),
  );

  for (const entry of health) {
    const rate = entry.scored === 0 ? "—" : `${(entry.hitRate * 100).toFixed(0)}%`;
    const verdict = verdictFor(entry, withStats.length);

    console.log(
      `  ${entry.name.padEnd(26)}${String(entry.scanned).padStart(9)}` +
        `${String(entry.scored).padStart(11)}${String(entry.published).padStart(11)}${rate.padStart(8)}` +
        (verdict ? `   ${color.yellow("← " + verdict)}` : ""),
    );
  }

  const silent = config.feeds
    .map((feed) => feed.name)
    .filter((name) => !health.some((entry) => entry.name === name));

  if (silent.length > 0) {
    console.log("");
    console.log(
      color.yellow(
        ui({
          tr: "  Hiç içerik vermeyen kaynaklar: ",
          en: "  Sources that produced nothing at all: ",
        }),
      ) + silent.join(", "),
    );
  }

  const orphaned = health.filter((entry) => !configured.has(entry.name));

  if (orphaned.length > 0) {
    console.log("");
    console.log(
      color.dim(
        ui(
          {
            tr: "  Geçmişte kullanılmış ama artık preset'te olmayan: {names}",
            en: "  Used in the past but no longer in the preset: {names}",
          },
          { names: orphaned.map((entry) => entry.name).join(", ") },
        ),
      ),
    );
  }

  console.log("");
}

main().catch((error: unknown) => {
  console.error(
    `\n  ${ui({ tr: "Hata", en: "Error" })}: ` +
      `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
