import { searchWeb } from "../tools/search-web.js";
import { isBlockedSource } from "../util/blocklist.js";
import { note, warn } from "../util/log.js";
import { domainOf } from "../util/url.js";
import type { TopicBrief } from "./brief.js";
import type { CandidateSite } from "./types.js";

const MAX_SITES = 30;

function toOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    return `https://${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return null;
  }
}

/**
 * Aday siteleri iki kaynaktan toplar: modelin hatırladığı alan adları
 * (anında, bedava, tanınmış yayınlar için şaşırtıcı derecede iyi) ve arama
 * sonuçları.
 *
 * Hiçbiri güvenilmiyor — buradan çıkan her adres findFeedForSite'tan geçmek
 * zorunda. "Model olmayan bir adres uydurdu" hata sınıfını çökerten kural bu.
 */
export async function findCandidateSites(
  brief: TopicBrief,
  onProgress?: (message: string) => void,
): Promise<CandidateSite[]> {
  const byOrigin = new Map<string, CandidateSite>();

  function add(name: string, url: string, why: string, via: "llm" | "search"): void {
    const origin = toOrigin(url);

    if (!origin || isBlockedSource(origin) || byOrigin.has(origin)) {
      return;
    }

    byOrigin.set(origin, {
      name: name.trim() || domainOf(origin),
      url,
      origin,
      why: why.trim().slice(0, 160),
      via,
    });
  }

  for (const domain of brief.seedDomains) {
    add(domain, domain, "modelin bildiği yayın", "llm");
  }

  onProgress?.(`${byOrigin.size} aday model hafızasından`);

  if (!process.env.TAVILY_API_KEY) {
    note("TAVILY_API_KEY yok, arama atlanıyor — yalnızca model önerileriyle devam.");
    return [...byOrigin.values()].slice(0, MAX_SITES);
  }

  for (const query of brief.searchQueries) {
    if (byOrigin.size >= MAX_SITES) {
      break;
    }

    try {
      for (const result of await searchWeb(query)) {
        add(result.title, result.url, result.snippet, "search");
      }

      onProgress?.(`"${query.slice(0, 40)}" → ${byOrigin.size} aday`);
    } catch (error) {
      warn(
        `Arama "${query.slice(0, 40)}" atlandı: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return [...byOrigin.values()].slice(0, MAX_SITES);
}
