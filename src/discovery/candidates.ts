import { ui } from "../i18n.js";
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
    add(
      domain,
      domain,
      ui({
        tr: "modelin bildiği yayın",
        en: "a publication the model knows",
      }),
      "llm",
    );
  }

  onProgress?.(
    ui(
      {
        tr: "{count} aday model hafızasından",
        en: "{count} candidates from the model's memory",
      },
      { count: byOrigin.size },
    ),
  );

  if (!process.env.TAVILY_API_KEY) {
    note(
      ui({
        tr: "TAVILY_API_KEY yok, arama atlanıyor — yalnızca model önerileriyle devam.",
        en: "No TAVILY_API_KEY, skipping search — carrying on with the model's suggestions only.",
      }),
    );
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

      onProgress?.(
        ui(
          {
            tr: '"{query}" → {count} aday',
            en: '"{query}" → {count} candidates',
          },
          { query: query.slice(0, 40), count: byOrigin.size },
        ),
      );
    } catch (error) {
      warn(
        ui(
          {
            tr: 'Arama "{query}" atlandı: {reason}',
            en: 'Search "{query}" skipped: {reason}',
          },
          {
            query: query.slice(0, 40),
            reason: error instanceof Error ? error.message : String(error),
          },
        ),
      );
    }
  }

  return [...byOrigin.values()].slice(0, MAX_SITES);
}
