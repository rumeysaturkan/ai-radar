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
import type { DiscoveryRequest, FeedFinding } from "./types.js";

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

export type DiscoverOptions = {
  assumeYes: boolean;
  force: boolean;
  id?: string;
};

export async function runDiscovery(
  request: DiscoveryRequest,
  options: DiscoverOptions,
): Promise<string | null> {
  const deps: FindFeedDeps = {
    fetchPage,
    parseFeed: parseFeedXml,
    now: () => new Date(),
  };

  // 1 — Konuyu aranabilir hale getir.
  step("Konu çözümleniyor...");
  const brief = await makeTopicBrief(request, MODELS.cheap);
  done(`${brief.searchQueries.length} sorgu, ${brief.seedDomains.length} tohum alan`);

  // 2 — Aday siteler. Buradan çıkan hiçbir adres doğrulanmadan kullanılmıyor.
  step("Aday kaynaklar aranıyor...");
  const sites = await findCandidateSites(brief, (message) => note(message));
  done(`${sites.length} aday site`);

  if (sites.length === 0) {
    warn("Hiç aday site bulunamadı. Konuyu biraz daha genel yazmayı dene.");
    return null;
  }

  // 3 — Feed bulma ve doğrulama. Tamamen deterministik.
  step(`${sites.length} sitede feed aranıyor...`);
  const findings = await findFeeds(sites, deps);
  const usable = findings.filter((finding) => finding.feed !== null);
  const rejected = findings.filter((finding) => finding.feed === null);
  const requests = findings.reduce((total, finding) => total + finding.requestCount, 0);
  done(`${usable.length} feed doğrulandı (${requests} istek)`);

  if (usable.length === 0) {
    warn("Doğrulanabilen hiç feed çıkmadı.");
    note(
      "Bu konuda RSS sunan kaynak bulunamadı. Google News akışıyla bir taban " +
        "preset kurulabilir ama içerik yalnızca arama özetinden gelir.",
    );
    return null;
  }

  // 4 — Güvenilirlik sıralaması, tek toplu çağrı.
  step("Kaynaklar değerlendiriliyor...");
  const ranked = await rankFeeds(usable, request, MODELS.cheap);
  done(`${ranked.filter((feed) => feed.verdict === "keep").length} kaynak öneriliyor`);

  // 5 — İnsan onayı. Buraya kadarki maliyet birkaç tenge.
  const approval = await approveFeeds(ranked, rejected, request, deps, {
    assumeYes: options.assumeYes,
  });

  if (approval.aborted || approval.accepted.length === 0) {
    note("Vazgeçildi, preset yazılmadı.");
    return null;
  }

  // 6 — Profil, KABUL EDİLEN feed'lerin gerçek başlıklarından. Onaydan sonra
  // çalışıyor: yarıda bırakılan çalıştırmada pahalı çağrı ödenmiyor.
  step("Alan profili çıkarılıyor...");
  const profile = await buildProfile(request, approval.accepted, MODELS.strong);
  done(`${profile.categories.length} kategori, ${profile.topics.length} konu`);

  const id = options.id ?? slugifyId(profile.name || request.topic);

  if (!id) {
    warn(`"${request.topic}" bir dosya adına çevrilemedi. --id ile bir kimlik ver.`);
    return null;
  }

  const config = buildPreset({
    id,
    language: request.language,
    profile,
    accepted: approval.accepted,
  });

  const problems = checkPreset(config);

  if (problems.length > 0) {
    warn("Üretilen preset doğrulamadan geçmedi:");

    for (const problem of problems) {
      note(`- ${problem}`);
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
        note("Yazılmadı.");
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

export { googleNewsFeed };
