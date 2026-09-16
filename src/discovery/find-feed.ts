import { mapWithConcurrency } from "../util/pool.js";
import { canonicalUrl } from "../util/url.js";
import { analyzeFeed, classify } from "./feed-health.js";
import {
  extractFeedLinks,
  harvestFeedHrefs,
  looksLikeFeedXml,
  probePaths,
  repairXml,
} from "./feed-links.js";
import type { PageFetcher } from "./net.js";
import type {
  CandidateSite,
  FeedFinding,
  FeedLink,
  ParsedFeed,
} from "./types.js";

/**
 * Nezaket ve maliyet sınırı. Bir site için en fazla bu kadar istek atılır;
 * merdiven erken çıkışlı olduğu için tipik site 2-3 istekte çözülüyor.
 */
const MAX_REQUESTS_PER_SITE = 12;

const SITE_CONCURRENCY = 5;

export type FindFeedDeps = {
  fetchPage: PageFetcher;
  parseFeed: (xml: string) => Promise<ParsedFeed>;
  now: () => Date;
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Attempt =
  | { kind: "feed"; parsed: ParsedFeed }
  /** Feed değil ama HTML; içinde feed adresleri olabilir. */
  | { kind: "html"; body: string; finalUrl: string }
  | { kind: "miss" };

/**
 * Bir adresin gerçekten okunabilir bir feed olup olmadığını, parse ederek
 * kanıtlar. LLM'in ürettiği hiçbir adres bu kapıdan geçmeden preset'e
 * giremez — "model halüsinasyon gördü" hata sınıfını çökerten kural bu.
 */
async function tryFeed(url: string, deps: FindFeedDeps): Promise<Attempt> {
  const page = await deps.fetchPage(url);

  if (page.status >= 400 || page.truncated) {
    return { kind: "miss" };
  }

  if (!looksLikeFeedXml(page.body)) {
    return { kind: "html", body: page.body, finalUrl: page.finalUrl };
  }

  try {
    return { kind: "feed", parsed: await deps.parseFeed(page.body) };
  } catch {
    // Çıplak & karakteri gerçek feed'lerde yaygın ve xml2js buna hata veriyor.
    try {
      return { kind: "feed", parsed: await deps.parseFeed(repairXml(page.body)) };
    } catch {
      return { kind: "miss" };
    }
  }
}

export async function findFeedForSite(
  site: CandidateSite,
  deps: FindFeedDeps,
): Promise<FeedFinding> {
  let requestCount = 0;
  let error: string | null = null;
  let homepageReachable = false;
  const candidates: FeedLink[] = [];

  // 1 — Ana sayfayı çek. Başarısız olsa bile yoklamaya devam edilir:
  // Cloudflare arkasındaki siteler HTML'de 403 verip /feed'i açık bırakıyor.
  try {
    requestCount += 1;
    const page = await deps.fetchPage(site.origin);

    if (page.status < 400) {
      homepageReachable = true;
      // finalUrl, istenen adres değil: yönlendirme varsa göreli href'ler
      // yanlış çözümlenir.
      candidates.push(...extractFeedLinks(page.body, page.finalUrl));
    } else {
      error = `ana sayfa ${page.status}`;
    }
  } catch (cause) {
    error = describe(cause);
  }

  // 2 — Bulunan linkler, sonra bilinen yollar. Sırayla, ilk geçerliyle çık.
  const probes: FeedLink[] = probePaths(site.origin).map((url) => ({
    url,
    title: null,
    via: "probe" as const,
  }));

  const seen = new Set(candidates.map((link) => canonicalUrl(link.url)));
  const ladder = [...candidates];

  for (const probe of probes) {
    const key = canonicalUrl(probe.url);

    if (!seen.has(key)) {
      seen.add(key);
      ladder.push(probe);
    }
  }

  // Merdiven ilerledikçe büyüyebilir: /rss adresi çoğu zaman bir feed değil,
  // feed'leri listeleyen bir HTML sayfası oluyor (ölçümde NTV ve Evrensel tam
  // olarak böyle kaçmıştı). O sayfadaki adresleri toplamak ek istek
  // gerektirmiyor, o yüzden atmak yerine okunuyor.
  let harvestsLeft = 2;

  for (let index = 0; index < ladder.length; index += 1) {
    if (requestCount >= MAX_REQUESTS_PER_SITE) {
      break;
    }

    const link = ladder[index]!;
    requestCount += 1;

    let attempt: Attempt;

    try {
      attempt = await tryFeed(link.url, deps);
    } catch (cause) {
      error ??= describe(cause);
      continue;
    }

    if (attempt.kind === "html") {
      if (harvestsLeft > 0) {
        harvestsLeft -= 1;

        const harvested = [
          ...extractFeedLinks(attempt.body, attempt.finalUrl),
          ...harvestFeedHrefs(attempt.body, attempt.finalUrl),
        ];

        for (const found of harvested) {
          const key = canonicalUrl(found.url);

          if (!seen.has(key)) {
            seen.add(key);
            // Sıradaki denemeye koy: bu sayfa özellikle feed listeliyor.
            ladder.splice(index + 1, 0, found);
          }
        }
      }

      continue;
    }

    if (attempt.kind === "miss") {
      continue;
    }

    const health = analyzeFeed(attempt.parsed, deps.now());
    const status = classify(health);

    // Boş bir feed işe yaramaz; merdivenin geri kalanını denemeye devam et.
    if (status === "empty") {
      continue;
    }

    return { site, feed: link, health, status, error: null, requestCount };
  }

  return {
    site,
    feed: null,
    health: null,
    status: homepageReachable || requestCount > 1 ? "no-feed" : "unreachable",
    error,
    requestCount,
  };
}

export async function findFeeds(
  sites: readonly CandidateSite[],
  deps: FindFeedDeps,
): Promise<FeedFinding[]> {
  return mapWithConcurrency(sites, SITE_CONCURRENCY, (site) =>
    findFeedForSite(site, deps),
  );
}
