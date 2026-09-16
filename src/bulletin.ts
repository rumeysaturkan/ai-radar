import { spawn } from "node:child_process";
import { listPresets, loadConfig } from "./config.js";
import { usageSoFar } from "./llm.js";
import { collectCandidates } from "./pipeline/collect.js";
import { composeIssue } from "./pipeline/compose.js";
import { dedupe } from "./pipeline/dedupe.js";
import { enrichItems } from "./pipeline/enrich.js";
import { writeHub, writeOutputs, type HubEntry } from "./pipeline/render.js";
import { scoreCandidates } from "./pipeline/score.js";
import { resolvePreset } from "./preset.js";
import { ensureKeys } from "./setup.js";
import { listIssues, readSeen, saveIssue, writeSeen } from "./store.js";
import type { Issue, ScoredCandidate } from "./types.js";
import { daysAgo, isoWeekId } from "./util/date.js";
import { banner, done, note, result, step, warn } from "./util/log.js";

/** Bülteni boş bırakmamak için puan eşiği gerektiğinde gevşetilir. */
const MIN_ITEMS = 5;

function select(
  scored: readonly ScoredCandidate[],
  minScore: number,
  shortlist: number,
): ScoredCandidate[] {
  const strong = scored.filter((item) => item.score >= minScore);

  if (strong.length >= MIN_ITEMS) {
    return strong.slice(0, shortlist);
  }

  return scored.slice(0, Math.min(shortlist, Math.max(MIN_ITEMS, strong.length)));
}

function openInBrowser(filePath: string): void {
  const command =
    process.platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", filePath] }
      : process.platform === "darwin"
        ? { cmd: "open", args: [filePath] }
        : { cmd: "xdg-open", args: [filePath] };

  try {
    spawn(command.cmd, command.args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Tarayıcı açılamazsa dosya yolu zaten ekrana yazılıyor.
  }
}

/** Kapak sayfasi icin her alanin arsiv durumunu toplar. */
async function hubEntries(): Promise<HubEntry[]> {
  const presets = await listPresets();
  const entries: HubEntry[] = [];

  for (const preset of presets) {
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
  const presetId = await resolvePreset(process.argv.slice(2));
  const config = await loadConfig(presetId);

  banner(config.title, config.tagline);

  await ensureKeys();

  // 1 — Topla
  step("Kaynaklar taranıyor...");
  const collected = await collectCandidates(config);
  done(
    `${collected.candidates.length} aday, ${collected.sourcesOk} kaynak` +
      (collected.sourcesFailed > 0
        ? `, ${collected.sourcesFailed} kaynak yanıt vermedi`
        : ""),
  );

  if (collected.candidates.length === 0) {
    warn(`Hiç içerik bulunamadı. presets/${config.id}.json içindeki kaynakları kontrol et.`);
    process.exitCode = 1;
    return;
  }

  // 2 — Tekilleştir
  step("Tekrarlar eleniyor...");
  const seen = await readSeen(config.id);
  const deduped = dedupe(collected.candidates, seen, config);
  done(`${deduped.fresh.length} yeni içerik`);
  note(
    `${deduped.alreadyPublished} tanesi önceki sayılarda yayınlanmıştı, ` +
      `${deduped.duplicatesDropped} tanesi kopyaydı.`,
  );

  if (deduped.fresh.length === 0) {
    warn("Bu hafta yeni bir şey yok. Daha sonra tekrar dene.");
    process.exitCode = 1;
    return;
  }

  // 3 — Puanla
  step("İçerikler puanlanıyor...");
  const scored = await scoreCandidates(config, deduped.fresh);
  done(`${scored.length} içerik değerlendirildi`);

  const selected = select(scored, config.minScore, config.shortlist);

  if (selected.length === 0) {
    warn("Eşiği geçen içerik çıkmadı.");
    process.exitCode = 1;
    return;
  }

  // 4 — Zenginleştir
  step(`${selected.length} haber okunup özetleniyor...`);
  const items = await enrichItems(config, selected);
  done(`${items.length} haber yazıldı`);

  if (items.length === 0) {
    warn("Hiçbir haber özetlenemedi.");
    process.exitCode = 1;
    return;
  }

  // 5 — Derle
  step("Sayı derleniyor...");
  const archive = await listIssues(config.id);
  const previous = archive[0];
  const composition = await composeIssue(config, items, previous);
  done("giriş ve sıralama hazır");

  const now = new Date();
  const highlight = items[composition.highlightIndex] ?? items[0];

  const issue: Issue = {
    id: isoWeekId(now),
    number: archive.length + 1,
    title: config.title,
    tagline: config.tagline,
    generatedAt: now.toISOString(),
    periodStart: daysAgo(config.windowDays).toISOString(),
    periodEnd: now.toISOString(),
    intro: composition.intro,
    highlightId: highlight?.id ?? "",
    items: [...items].sort(
      (a, b) =>
        composition.categoryOrder.indexOf(a.category) -
          composition.categoryOrder.indexOf(b.category) || b.score - a.score,
    ),
    stats: {
      collected: collected.candidates.length,
      fresh: deduped.fresh.length,
      scored: scored.length,
      published: items.length,
    },
    usage: usageSoFar(),
  };

  // 6 — Yayınla
  step("Sayfa üretiliyor...");

  // Yalnızca yayınlananlar hafızaya yazılır; elenenler gelecek hafta
  // olgunlaşırsa tekrar değerlendirilebilsin.
  for (const item of issue.items) {
    seen[item.id] = {
      url: item.url,
      title: item.title,
      firstSeen: now.toISOString(),
    };
  }

  await writeSeen(config.id, seen);
  await saveIssue(config.id, issue);

  const previousIssues = archive.filter((entry) => entry.id !== issue.id);
  const paths = await writeOutputs(
    config,
    issue,
    [issue, ...previousIssues],
    config.siteUrl,
  );
  const hubPath = await writeHub(await hubEntries(), config.language);
  done(`sayı ${issue.number} hazır`);

  console.log("");
  result("Bülten  :", paths.html);
  result("Markdown:", paths.markdown);
  result("Arşiv   :", paths.index);
  result("Alanlar :", hubPath);
  result(
    "Maliyet :",
    `$${issue.usage.estimatedCostUsd.toFixed(3)} (${issue.usage.inputTokens} girdi / ${issue.usage.outputTokens} çıktı token)`,
  );
  console.log("");

  openInBrowser(paths.html);
}

main().catch((error: unknown) => {
  console.error(
    `\n  Hata: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
