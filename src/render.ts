import { listPresets, loadConfig } from "./config.js";
import { ui, uiLang } from "./i18n.js";
import { resolveSiteUrl, writeHub, writeOutputs, type HubEntry } from "./pipeline/render.js";
import { listIssues } from "./store.js";
import { color } from "./util/log.js";

async function renderPreset(id: string): Promise<number> {
  const config = await loadConfig(id);
  const issues = await listIssues(id);

  if (issues.length === 0) {
    return 0;
  }

  const latest = issues[0]!;
  const siteUrl = resolveSiteUrl(config);
  const paths = await writeOutputs(config, latest, issues, siteUrl);

  console.log(
    `  ${color.green("✓")} ${id.padEnd(16)} ` +
      ui(
        { tr: "{count} sayı", en: "{count} issues" },
        { count: issues.length },
      ) +
      `  ${color.dim(paths.index)}`,
  );

  return issues.length;
}

async function hubEntries(): Promise<HubEntry[]> {
  const entries: HubEntry[] = [];

  for (const preset of await listPresets()) {
    const issues = await listIssues(preset.id);
    const latest = issues[0];

    entries.push({
      id: preset.id,
      name: preset.name,
      tagline: preset.tagline,
      issueCount: issues.length,
      latest: latest
        ? { id: latest.id, number: latest.number, periodEnd: latest.periodEnd }
        : null,
    });
  }

  return entries;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const presets = await listPresets();
  const ids = requested.length > 0 ? requested : presets.map((p) => p.id);

  console.log("");

  let total = 0;

  for (const id of ids) {
    try {
      total += await renderPreset(id);
    } catch (error) {
      console.error(
        `  ${color.yellow("!")} ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (total === 0) {
    console.log(
      `  ${color.dim(
        ui({
          tr: "Arşivde hiç sayı yok. Önce `npm start <alan>` çalıştır.",
          en: "The archive is empty. Run `npm start <domain>` first.",
        }),
      )}`,
    );
    console.log("");
    return;
  }

  const hub = await writeHub(await hubEntries(), uiLang());
  console.log(
    `  ${color.green("✓")} ${ui({ tr: "kapak", en: "cover" }).padEnd(16)}` +
      `    ${color.dim(hub)}`,
  );
  console.log("");
}

main().catch((error: unknown) => {
  console.error(
    `\n  ${ui({ tr: "Hata", en: "Error" })}: ` +
      `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
