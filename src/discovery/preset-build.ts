import type { Config, Feed } from "../config.js";
import { validateConfig } from "../config-validate.js";
import { domainOf } from "../util/url.js";
import type { RankedFeed } from "./types.js";

/**
 * Türkçe harfleri ASCII karşılıklarına indirger.
 *
 * Katlama toLowerCase'den ÖNCE yapılmak zorunda: JavaScript'te
 * "İ".toLowerCase() birleştirici noktalı "i̇" üretiyor ve bu, config.ts'teki
 * ^[a-z0-9][a-z0-9-]*$ kontrolünü geçmeyen bir kimlik demek.
 */
const FOLD: Record<string, string> = {
  İ: "i", I: "i", ı: "i",
  Ğ: "g", ğ: "g",
  Ş: "s", ş: "s",
  Ç: "c", ç: "c",
  Ö: "o", ö: "o",
  Ü: "u", ü: "u",
};

export function slugifyId(input: string): string {
  const folded = [...input].map((ch) => FOLD[ch] ?? ch).join("");

  const slug = folded
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

  // Kimlik rakamla başlayamaz; klasör adı olarak da kullanılıyor.
  return /^[0-9]/.test(slug) ? `x-${slug}` : slug;
}

/**
 * Feed adları kozmetik değil: collect.ts candidate.source = feed.name yapıyor
 * ve dedupe.ts kaynak başına kotayı bu adla tutuyor. Aynı adı taşıyan iki
 * besleme sessizce tek kotayı paylaşır ve biri diğerini yutar.
 */
export function uniquifyNames(names: readonly string[], urls: readonly string[]): string[] {
  const used = new Set<string>();

  return names.map((rawName, index) => {
    const name = rawName.trim() || domainOf(urls[index] ?? "") || `Kaynak ${index + 1}`;

    if (!used.has(name)) {
      used.add(name);
      return name;
    }

    const domain = domainOf(urls[index] ?? "");
    const withDomain = domain ? `${name} (${domain})` : `${name} ${index + 1}`;

    if (!used.has(withDomain)) {
      used.add(withDomain);
      return withDomain;
    }

    let suffix = 2;

    while (used.has(`${name} ${suffix}`)) {
      suffix += 1;
    }

    used.add(`${name} ${suffix}`);
    return `${name} ${suffix}`;
  });
}

export type DomainProfile = {
  name: string;
  title: string;
  tagline: string;
  audience: string;
  topics: string[];
  categories: string[];
  hackerNewsQueries: string[];
  webSearchQueries: string[];
};

export type BuildInput = {
  id: string;
  language: string;
  profile: DomainProfile;
  accepted: readonly RankedFeed[];
};

export function buildPreset(input: BuildInput): Config {
  const { profile, accepted } = input;

  const names = uniquifyNames(
    accepted.map((entry) => entry.suggestedName),
    accepted.map((entry) => entry.feed?.url ?? ""),
  );

  const feeds: Feed[] = accepted.map((entry, index) => {
    const feed: Feed = {
      name: names[index]!,
      url: entry.feed?.url ?? "",
    };

    // Hacimli kaynaklara kendi kotası verilir; yoksa havuzu doldururlar.
    const suggested = entry.health?.suggestedMax;

    if (suggested !== undefined && suggested < 12) {
      feed.max = suggested;
    }

    return feed;
  });

  return {
    id: input.id,
    name: profile.name,
    title: profile.title,
    tagline: profile.tagline,
    language: input.language,
    siteUrl: "",
    audience: profile.audience,
    topics: profile.topics,
    categories: profile.categories,
    windowDays: 7,
    candidateLimit: 160,
    maxPerSource: 12,
    shortlist: 12,
    minScore: 6,
    models: { scorer: "gpt-5-mini", writer: "gpt-5.1" },
    reasoningEffort: "low",
    feeds,
    hackerNews: {
      enabled: profile.hackerNewsQueries.length > 0,
      minPoints: 80,
      queries: profile.hackerNewsQueries,
    },
    webSearch: {
      enabled: profile.webSearchQueries.length > 0,
      queries: profile.webSearchQueries,
    },
  };
}

/** Yazmadan önceki son kapı; loadConfig'in kullandığı doğrulayıcının aynısı. */
export function checkPreset(config: Config): string[] {
  return validateConfig(
    JSON.parse(JSON.stringify(config)) as unknown,
    config.id,
  ).problems;
}
