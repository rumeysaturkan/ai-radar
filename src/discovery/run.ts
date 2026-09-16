import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { presetPath } from "../config.js";
import { usageSoFar } from "../llm.js";
import { color, done, note, step, warn } from "../util/log.js";
import { approveFeeds } from "./approve.js";
import { makeTopicBrief } from "./brief.js";
import { findCandidateSites } from "./candidates.js";
import { findFeeds, type FindFeedDeps } from "./find-feed.js";
import { fetchPage, parseFeedXml } from "./net.js";
import { buildPreset, checkPreset, slugifyId } from "./preset-build.js";
import { buildProfile } from "./profile.js";
import { rankFeeds } from "./rank.js";
import type { DiscoveryRequest, FeedFinding, RankedFeed } from "./types.js";

const MODELS = { cheap: "gpt-5-mini", strong: "gpt-5.1" };

/** Google News, hiçbir kaynak bulunamadığında son çare. */
function googleNewsFeed(topic: string, language: string): string {
  const region = language === "tr" ? "TR" : "US";
  const params = new URLSearchParams({
    q: topic,
    hl: language,
    gl: region,
    ceid: `${region}:${language}`,
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type DiscoveryEvent =
  | { kind: "step"; label: string }
  | { kind: "note"; label: string }
  | { kind: "done"; label: string };

export type DiscoverOptions = {
  assumeYes: boolean;
  force: boolean;
  id?: string;
  /** Verilmezse ilerleme terminale basılır. */
  onEvent?: (event: DiscoveryEvent) => void;
};

export type DiscoveryOutcome = {
  ranked: RankedFeed[];
  rejected: FeedFinding[];
  deps: FindFeedDeps;
};

/**
 * Keşfin insan onayına kadarki kısmı. Ayrı durmasının sebebi, onayın nerede
 * alındığının değişmesi: terminalde readline, tarayıcıda bir form.
 */
export async function discoverSources(
  request: DiscoveryRequest,
  options: { onEvent?: (event: DiscoveryEvent) => void } = {},
): Promise<DiscoveryOutcome | null> {
  const deps: FindFeedDeps = {
    fetchPage,
    parseFeed: parseFeedXml,
    now: () => new Date(),
  };

  // Sunucu aynı akışı SSE'ye aktarabilsin diye ilerleme olay olarak çıkıyor.
  const emit = options.onEvent;
  const emitStep = (label: string) => (emit ? emit({ kind: "step", label }) : step(label));
  const emitNote = (label: string) => (emit ? emit({ kind: "note", label }) : note(label));
  const emitDone = (label: string) => (emit ? emit({ kind: "done", label }) : done(label));

  // 1 — Konuyu aranabilir hale getir.
  emitStep("Konu çözümleniyor...");
  const brief = await makeTopicBrief(request, MODELS.cheap);
  emitDone(`${brief.searchQueries.length} sorgu, ${brief.seedDomains.length} tohum alan`);

  // 2 — Aday siteler. Buradan çıkan hiçbir adres doğrulanmadan kullanılmıyor.
  emitStep("Aday kaynaklar aranıyor...");
  const sites = await findCandidateSites(brief, emitNote);
  emitDone(`${sites.length} aday site`);

  if (sites.length === 0) {
    warn("Hiç aday site bulunamadı. Konuyu biraz daha genel yazmayı dene.");
    return null;
  }

  // 3 — Feed bulma ve doğrulama. Tamamen deterministik.
  emitStep(`${sites.length} sitede feed aranıyor...`);
  const findings = await findFeeds(sites, deps);
  const usable = findings.filter((finding) => finding.feed !== null);
  const rejected = findings.filter((finding) => finding.feed === null);
  const requests = findings.reduce((total, finding) => total + finding.requestCount, 0);
  emitDone(`${usable.length} feed doğrulandı (${requests} istek)`);

  if (usable.length === 0) {
    warn("Doğrulanabilen hiç feed çıkmadı.");
    emitNote(
      "Bu konuda RSS sunan kaynak bulunamadı. Google News akışıyla bir taban " +
        "preset kurulabilir ama içerik yalnızca arama özetinden gelir.",
    );
    return null;
  }

  // 4 — Güvenilirlik sıralaması, tek toplu çağrı.
  emitStep("Kaynaklar değerlendiriliyor...");
  const ranked = await rankFeeds(usable, request, MODELS.cheap);
  emitDone(`${ranked.filter((feed) => feed.verdict === "keep").length} kaynak öneriliyor`);

  return { ranked, rejected, deps };
}

/**
 * Onaylanmış kaynaklardan preset üretip yazar. Profil çağrısı burada:
 * yarıda bırakılan bir çalıştırma pahalı çağrıyı ödemiyor.
 */
export async function finalizePreset(
  request: DiscoveryRequest,
  accepted: readonly RankedFeed[],
  options: DiscoverOptions,
): Promise<string | null> {
  const emit = options.onEvent;
  const emitStep = (label: string) => (emit ? emit({ kind: "step", label }) : step(label));
  const emitNote = (label: string) => (emit ? emit({ kind: "note", label }) : note(label));
  const emitDone = (label: string) => (emit ? emit({ kind: "done", label }) : done(label));

  // 6 — Profil, KABUL EDİLEN feed'lerin gerçek başlıklarından. Onaydan sonra
  // çalışıyor: yarıda bırakılan çalıştırmada pahalı çağrı ödenmiyor.
  emitStep("Alan profili çıkarılıyor...");
  const profile = await buildProfile(request, accepted, MODELS.strong);
  emitDone(`${profile.categories.length} kategori, ${profile.topics.length} konu`);

  const id = options.id ?? slugifyId(profile.name || request.topic);

  if (!id) {
    warn(`"${request.topic}" bir dosya adına çevrilemedi. --id ile bir kimlik ver.`);
    return null;
  }

  const config = buildPreset({
    id,
    language: request.language,
    profile,
    accepted: accepted,
  });

  const problems = checkPreset(config);

  if (problems.length > 0) {
    warn("Üretilen preset doğrulamadan geçmedi:");

    for (const problem of problems) {
      emitNote(`- ${problem}`);
    }

    return null;
  }

  const path = presetPath(id);

  if ((await exists(path)) && !options.force) {
    if (!process.stdin.isTTY) {
      warn(`presets/${id}.json zaten var. Üzerine yazmak için --force ver.`);
      return null;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      const answer = (
        await rl.question(`  presets/${id}.json zaten var. Üzerine yazılsın mı? [e/H] `)
      ).trim().toLowerCase();

      if (answer !== "e" && answer !== "y") {
        emitNote("Yazılmadı.");
        return null;
      }
    } finally {
      rl.close();
    }
  }

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`  ${color.green("✓")} presets/${id}.json yazıldı`);
  console.log(
    color.dim(
      `     ${config.feeds.length} kaynak · ${config.categories.join(", ")}`,
    ),
  );

  const usage = usageSoFar();
  console.log(color.dim(`     keşif maliyeti $${usage.estimatedCostUsd.toFixed(4)}`));
  console.log("");
  console.log(`  Şimdi:  ${color.bold(`npm start ${id}`)}`);
  console.log("");

  return id;
}


/** CLI yolu: keşif, terminalde onay, preset. */
export async function runDiscovery(
  request: DiscoveryRequest,
  options: DiscoverOptions,
): Promise<string | null> {
  const outcome = await discoverSources(request, options);

  if (!outcome) {
    return null;
  }

  const approval = await approveFeeds(
    outcome.ranked,
    outcome.rejected,
    request,
    outcome.deps,
    { assumeYes: options.assumeYes },
  );

  if (approval.aborted || approval.accepted.length === 0) {
    note("Vazgeçildi, preset yazılmadı.");
    return null;
  }

  return finalizePreset(request, approval.accepted, options);
}

export { googleNewsFeed };
