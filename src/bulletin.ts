import { spawn } from "node:child_process";
import { listPresets, loadConfig } from "./config.js";
import { unpricedModels, usageSoFar } from "./llm.js";
import { collectCandidates } from "./pipeline/collect.js";
import { composeIssue } from "./pipeline/compose.js";
import { dedupe } from "./pipeline/dedupe.js";
import { enrichItems } from "./pipeline/enrich.js";
import {
  resolveSiteUrl,
  writeHub,
  writeOutputs,
  type HubEntry,
} from "./pipeline/render.js";
import { scoreCandidates } from "./pipeline/score.js";
import { select } from "./pipeline/select.js";
import { sourceStats } from "./pipeline/stats.js";
import { ui } from "./i18n.js";
import { resolvePreset } from "./preset.js";
import { ensureKeys } from "./setup.js";
import { listIssues, readSeen, saveIssue, writeSeen } from "./store.js";
import type { Issue } from "./types.js";
import { daysAgo, isoWeekId } from "./util/date.js";
import { banner, done, note, result, step, warn } from "./util/log.js";

function openInBrowser(filePath: string): void {
  if (process.env.CI || !process.stdout.isTTY) {
    return;
  }

  const command =
    process.platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", filePath] }
      : process.platform === "darwin"
        ? { cmd: "open", args: [filePath] }
        : { cmd: "xdg-open", args: [filePath] };

  try {
    const child = spawn(command.cmd, command.args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", () => {});
    child.unref();
  } catch {
  }
}

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

  step(ui({ tr: "Kaynaklar taranıyor...", en: "Scanning sources..." }));
  const collected = await collectCandidates(config);
  done(
    ui(
      {
        tr: "{candidates} aday, {ok} kaynak",
        en: "{candidates} candidates from {ok} sources",
      },
      { candidates: collected.candidates.length, ok: collected.sourcesOk },
    ) +
      (collected.sourcesFailed > 0
        ? ui(
            {
              tr: ", {failed} kaynak yanıt vermedi",
              en: ", {failed} did not answer",
            },
            { failed: collected.sourcesFailed },
          )
        : ""),
  );

  if (collected.candidates.length === 0) {
    warn(
      ui(
        {
          tr: "Hiç içerik bulunamadı. presets/{id}.json içindeki kaynakları kontrol et.",
          en: "Nothing was found at all. Check the sources in presets/{id}.json.",
        },
        { id: config.id },
      ),
    );
    process.exitCode = 1;
    return;
  }

  step(ui({ tr: "Tekrarlar eleniyor...", en: "Dropping repeats..." }));
  const seen = await readSeen(config.id);
  const deduped = dedupe(collected.candidates, seen, config);
  done(
    ui(
      { tr: "{count} yeni içerik", en: "{count} new items" },
      { count: deduped.fresh.length },
    ),
  );
  note(
    ui(
      {
        tr:
          "{published} tanesi önceki sayılarda yayınlanmıştı, " +
          "{duplicates} tanesi kopyaydı.",
        en:
          "{published} appeared in earlier issues, " +
          "{duplicates} were duplicates.",
      },
      {
        published: deduped.alreadyPublished,
        duplicates: deduped.duplicatesDropped,
      },
    ),
  );

  if (deduped.fresh.length === 0) {
    warn(
      ui({
        tr: "Bu hafta yeni bir şey yok. Daha sonra tekrar dene.",
        en: "Nothing new this week. Try again later.",
      }),
    );
    process.exitCode = 1;
    return;
  }

  step(ui({ tr: "İçerikler puanlanıyor...", en: "Scoring candidates..." }));
  const issueId = isoWeekId(new Date());
  const scored = await scoreCandidates(config, deduped.fresh, { seed: issueId });
  done(
    ui(
      { tr: "{count} içerik değerlendirildi", en: "{count} rated" },
      { count: scored.length },
    ),
  );

  const selected = select(scored, {
    minScore: config.minScore,
    shortlist: config.shortlist,
  });

  if (selected.length === 0) {
    warn(
      ui({
        tr: "Eşiği geçen içerik çıkmadı.",
        en: "Nothing cleared the threshold.",
      }),
    );
    process.exitCode = 1;
    return;
  }

  step(
    ui(
      {
        tr: "{count} haber okunup özetleniyor...",
        en: "Reading and summarising {count} stories...",
      },
      { count: selected.length },
    ),
  );
  const items = await enrichItems(config, selected);
  done(
    ui(
      { tr: "{count} haber yazıldı", en: "{count} stories written" },
      { count: items.length },
    ),
  );

  if (items.length === 0) {
    warn(
      ui({
        tr: "Hiçbir haber özetlenemedi.",
        en: "Not one story could be summarised.",
      }),
    );
    process.exitCode = 1;
    return;
  }

  step(ui({ tr: "Sayı derleniyor...", en: "Composing the issue..." }));
  const archive = await listIssues(config.id);
  const previous = archive[0];
  const composition = await composeIssue(config, items, previous);
  done(
    ui({
      tr: "giriş ve sıralama hazır",
      en: "intro and running order ready",
    }),
  );

  const now = new Date();
  const highlight = items[composition.highlightIndex] ?? items[0];

  const existing = archive.find((entry) => entry.id === issueId);

  const issue: Issue = {
    id: issueId,
    number: existing?.number ?? archive.length + 1,
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
    candidates: scored,
    sources: sourceStats(collected.candidates, scored, items),
  };

  step(ui({ tr: "Sayfa üretiliyor...", en: "Writing the pages..." }));

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
  const siteUrl = resolveSiteUrl(config);
  const paths = await writeOutputs(
    config,
    issue,
    [issue, ...previousIssues],
    siteUrl,
  );
  const hubPath = await writeHub(await hubEntries(), config.language);
  done(
    ui(
      { tr: "sayı {number} hazır", en: "issue {number} is ready" },
      { number: issue.number },
    ),
  );

  console.log("");
  const label = (text: { tr: string; en: string }) => ui(text).padEnd(9) + ":";

  result(label({ tr: "Bülten", en: "Issue" }), paths.html);
  result(label({ tr: "Markdown", en: "Markdown" }), paths.markdown);
  result(label({ tr: "Arşiv", en: "Archive" }), paths.index);
  result(label({ tr: "Alanlar", en: "Domains" }), hubPath);

  if (paths.feed) {
    result(label({ tr: "RSS", en: "RSS" }), paths.feed);
  } else {
    note(
      ui(
        {
          tr:
            'RSS akışı üretilmedi: presets/{id}.json içindeki "siteUrl" boş ' +
            "(ya da RADAR_SITE_URL tanımla). Mutlak adres olmadan akış geçersiz olur.",
          en:
            'No RSS feed was written: "siteUrl" in presets/{id}.json is empty ' +
            "(or set RADAR_SITE_URL). Without an absolute address the feed is invalid.",
        },
        { id: config.id },
      ),
    );
  }

  result(
    label({ tr: "Maliyet", en: "Cost" }),
    `$${issue.usage.estimatedCostUsd.toFixed(3)} ` +
      ui(
        {
          tr: "({input} girdi / {output} çıktı token)",
          en: "({input} in / {output} out tokens)",
        },
        {
          input: issue.usage.inputTokens,
          output: issue.usage.outputTokens,
        },
      ),
  );

  for (const stage of issue.usage.stages ?? []) {
    note(
      `${stage.stage.padEnd(8)} ${stage.model.padEnd(12)} ` +
        `$${stage.estimatedCostUsd.toFixed(4).padStart(8)}  ` +
        ui(
          {
            tr: "{calls} çağrı, {input}/{output} token",
            en: "{calls} calls, {input}/{output} tokens",
          },
          {
            calls: stage.calls,
            input: stage.inputTokens,
            output: stage.outputTokens,
          },
        ),
    );
  }

  const unpriced = unpricedModels();

  if (unpriced.length > 0) {
    warn(
      ui(
        {
          tr:
            "Fiyatı bilinmeyen model: {models}. " +
            "Gösterilen maliyet eksik — src/llm.ts içindeki PRICING tablosuna ekle.",
          en:
            "No price is known for: {models}. " +
            "The reported cost is short — add it to PRICING in src/llm.ts.",
        },
        { models: unpriced.join(", ") },
      ),
    );
  }
  console.log("");

  openInBrowser(paths.html);
}

main().catch((error: unknown) => {
  console.error(
    `\n  ${ui({ tr: "Hata", en: "Error" })}: ` +
      `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
