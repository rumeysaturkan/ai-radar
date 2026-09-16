/**
 * İki ayrı dil var ve karıştırılmamaları gerekiyor:
 *
 * - contentLang (config.language): bültenin dili. Prompt'ların çıktı dili,
 *   tarih biçimi, <html lang>, öğe içi başlıklar, RSS <language>.
 * - uiLang (RADAR_LANG env → sistem yerel ayarı → "en"): terminalin ve
 *   alanlar arası kapak sayfasının dili. Kapak tek bir alana ait olmadığı
 *   için bülten diliyle damgalanamaz.
 */

export type Lang = "tr" | "en";

const SUPPORTED: Lang[] = ["tr", "en"];

export function resolveLang(tag: string | undefined): Lang {
  const base = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.find((lang) => lang === base) ?? "en";
}

let cachedUiLang: Lang | null = null;

export function uiLang(): Lang {
  cachedUiLang ??= resolveLang(
    process.env.RADAR_LANG ??
      new Intl.DateTimeFormat().resolvedOptions().locale,
  );
  return cachedUiLang;
}

/**
 * Dil adını Node'un kendi verisinden alır — elde tutulacak bir tablo yok ve
 * her BCP-47 etiketi için çalışır.
 */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * Prompt gövdeleri İngilizce kalıyor; yalnızca çıktı dili parametreleniyor.
 * Dil başına ayrı bir rubrik tutmak, yalnızca modelin okuduğu bir metni
 * bakıma mahkûm eder ve her prompt düzenlemesini ikiye katlardı.
 */
export function outputLanguageRule(tag: string): string {
  return (
    `Write every output field in ${languageName(tag)}. ` +
    "Keep proper nouns, product names and version numbers in their original form."
  );
}

type Key =
  | "html.whyItMatters"
  | "html.highlight"
  | "html.issue"
  | "html.itemCount"
  | "html.archive"
  | "html.allIssues"
  | "html.scanned"
  | "html.fresh"
  | "html.published"
  | "html.cost"
  | "html.compiledBy"
  | "html.points"
  | "html.noIssues"
  | "hub.title"
  | "hub.tagline"
  | "hub.lede"
  | "hub.domains"
  | "hub.issueCount"
  | "hub.pending"
  | "hub.noDomains"
  | "index.lede"
  | "md.highlight"
  | "md.whyItMatters"
  | "md.footer";

/**
 * Record<Lang, Record<Key, string>> olduğu için eksik bir çeviri derleme
 * hatası veriyor. "i18n altyapısı" bundan ibaret.
 */
const STRINGS: Record<Lang, Record<Key, string>> = {
  tr: {
    "html.whyItMatters": "Neden önemli:",
    "html.highlight": "Haftanın öne çıkanı",
    "html.issue": "SAYI",
    "html.itemCount": "haber",
    "html.archive": "Arşiv",
    "html.allIssues": "Tüm sayılar",
    "html.scanned": "aday tarandı",
    "html.fresh": "yeni içerik",
    "html.published": "bültene girdi",
    "html.cost": "üretim maliyeti",
    "html.compiledBy": "tarafından {date} tarihinde otomatik derlendi.",
    "html.points": "puan",
    "html.noIssues": "Henüz sayı yok.",
    "hub.title": "Radar",
    "hub.tagline": "Haftalık bültenler",
    "hub.lede":
      "Her alan kendi kaynaklarını tarar, tekrarları eler ve kalanları puanlar. Bir alanı seçip arşivine göz at.",
    "hub.domains": "Alanlar",
    "hub.issueCount": "sayı",
    "hub.pending": "Henüz sayı yok",
    "hub.noDomains": "Henüz alan yok.",
    "index.lede":
      "Her sayı otomatik derleniyor: kaynaklar taranır, tekrarlar elenir, kalanlar puanlanır ve en iyileri buraya düşer.",
    "md.highlight": "Haftanın öne çıkanı",
    "md.whyItMatters": "Neden önemli:",
    "md.footer":
      "{collected} aday tarandı, {published} haber seçildi. {title} ile otomatik derlendi.",
  },
  en: {
    "html.whyItMatters": "Why it matters:",
    "html.highlight": "This week's pick",
    "html.issue": "ISSUE",
    "html.itemCount": "stories",
    "html.archive": "Archive",
    "html.allIssues": "All issues",
    "html.scanned": "candidates scanned",
    "html.fresh": "new items",
    "html.published": "made the issue",
    "html.cost": "cost to produce",
    "html.compiledBy": "compiled automatically by {title} on {date}.",
    "html.points": "points",
    "html.noIssues": "No issues yet.",
    "hub.title": "Radar",
    "hub.tagline": "Weekly briefings",
    "hub.lede":
      "Each domain scans its own sources, drops the repeats and scores what is left. Pick one and browse its archive.",
    "hub.domains": "Domains",
    "hub.issueCount": "issues",
    "hub.pending": "No issues yet",
    "hub.noDomains": "No domains yet.",
    "index.lede":
      "Every issue is compiled automatically: sources are scanned, repeats dropped, the rest scored, and the best land here.",
    "md.highlight": "This week's pick",
    "md.whyItMatters": "Why it matters:",
    "md.footer":
      "{collected} candidates scanned, {published} stories selected. Compiled automatically with {title}.",
  },
};

export function t(
  lang: string,
  key: Key,
  vars: Record<string, string | number> = {},
): string {
  const table = STRINGS[resolveLang(lang)];
  let text = table[key];

  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }

  return text;
}
