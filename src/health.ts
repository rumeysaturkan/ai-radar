import { loadConfig } from "./config.js";
import { aggregate, verdictFor } from "./health-stats.js";
import { listIssues } from "./store.js";
import { color } from "./util/log.js";

async function main(): Promise<void> {
  const [presetId] = process.argv.slice(2);

  if (!presetId) {
    console.error("\n  Kullanım: npm run health <alan>\n");
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig(presetId);
  const issues = await listIssues(presetId);
  const withStats = issues.filter((issue) => issue.sources && issue.sources.length > 0);

  console.log("");
  console.log(color.bold(color.cyan(`  ${config.title} — kaynak sağlığı`)));

  if (withStats.length === 0) {
    console.log(
      color.dim(
        `  ${issues.length} sayı var ama hiçbiri kaynak istatistiği içermiyor.`,
      ),
    );
    console.log(color.dim("  Bir sonraki `npm start` çalıştırması kaydedecek.\n"));
    return;
  }

  console.log(
    color.dim(`  ${withStats.length} sayı üzerinden${withStats.length < 3 ? " (öneri için en az 3 sayı gerekli)" : ""}`),
  );
  console.log("");

  const health = aggregate(withStats.map((issue) => issue.sources ?? []));
  const configured = new Set(config.feeds.map((feed) => feed.name));

  console.log(
    color.dim(
      `  ${"kaynak".padEnd(26)}${"taranan".padStart(9)}${"puanlanan".padStart(11)}${"yayın".padStart(7)}${"oran".padStart(8)}`,
    ),
  );

  for (const entry of health) {
    const rate = entry.scored === 0 ? "—" : `${(entry.hitRate * 100).toFixed(0)}%`;
    const verdict = verdictFor(entry, withStats.length);

    console.log(
      `  ${entry.name.padEnd(26)}${String(entry.scanned).padStart(9)}` +
        `${String(entry.scored).padStart(11)}${String(entry.published).padStart(7)}${rate.padStart(8)}` +
        (verdict ? `   ${color.yellow("← " + verdict)}` : ""),
    );
  }

  const silent = config.feeds
    .map((feed) => feed.name)
    .filter((name) => !health.some((entry) => entry.name === name));

  if (silent.length > 0) {
    console.log("");
    console.log(
      color.yellow("  Hiç içerik vermeyen kaynaklar: ") + silent.join(", "),
    );
  }

  const orphaned = health.filter((entry) => !configured.has(entry.name));

  if (orphaned.length > 0) {
    console.log("");
    console.log(
      color.dim(
        `  Geçmişte kullanılmış ama artık preset'te olmayan: ${orphaned
          .map((entry) => entry.name)
          .join(", ")}`,
      ),
    );
  }

  console.log("");
}

main().catch((error: unknown) => {
  console.error(
    `\n  Hata: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
