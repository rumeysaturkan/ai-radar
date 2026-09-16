import { canonicalUrl } from "../util/url.js";
import type { FeedLink } from "./types.js";

/**
 * Bir sitenin RSS adresini bulmak, keşfin en zor ve en deterministik parçası.
 * Arama sana wired.com veriyor, wired.com/feed/rss vermiyor.
 *
 * Buradaki her kural gerçek bir başarısızlığa karşılık geliyor; hangisi
 * olduğu ilgili yerde yazıyor.
 */

/** rss-parser JSON Feed okuyamıyor, o yüzden json tipleri kasten dışarıda. */
const FEED_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/rdf+xml",
  "text/xml",
  "application/xml",
]);

const ATTRIBUTE = /([a-z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    const raw = match[2] ?? "";

    if (!name) {
      continue;
    }

    const value =
      raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;

    if (!found.has(name)) {
      found.set(name, value);
    }
  }

  return found;
}

function decodeAmp(value: string): string {
  // Sorgu dizeli feed adresleri yaygın: /?feed=rss2&amp;cat=1
  return value.replace(/&amp;/gi, "&");
}

export function resolveHref(href: string, baseUrl: string): string | null {
  try {
    return new URL(decodeAmp(href.trim()), baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Sayfadaki <link rel="alternate"> etiketlerinden feed adreslerini çıkarır.
 */
export function extractFeedLinks(html: string, baseUrl: string): FeedLink[] {
  // Yorumları önce çıkar: aksi halde yoruma alınmış feed linkleri ve script
  // içindeki şablonlar da eşleşiyor.
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ");

  const found: FeedLink[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);

    // rel boşlukla ayrılmış bir token listesi; rel="alternate home" gerçek
    // (WordPress üretiyor).
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);

    if (!rel.includes("alternate")) {
      continue;
    }

    // Asıl tuzak burada. <link rel="alternate" hreflang="de" type="text/html">
    // sitelerin çok büyük bir kısmında var ve feed DEĞİL. Feed'e benzeyen bir
    // type zorunlu.
    const type = (attrs.get("type") ?? "").toLowerCase().split(";")[0]?.trim();

    if (!type || !FEED_TYPES.has(type)) {
      continue;
    }

    const href = attrs.get("href");

    if (!href) {
      continue;
    }

    const url = resolveHref(href, baseUrl);

    if (!url) {
      continue;
    }

    const key = canonicalUrl(url);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    found.push({ url, title: attrs.get("title") ?? null, via: "link-tag" });
  }

  // Belge sırası korunur — ilk <link> neredeyse her zaman ana akış — ama
  // yorum akışları sona itilir.
  return [
    ...found.filter((link) => !/comment/i.test(link.url + (link.title ?? ""))),
    ...found.filter((link) => /comment/i.test(link.url + (link.title ?? ""))),
  ];
}

/** Bir dizin sayfasından alınacak azami aday; liste uzun olabiliyor. */
const MAX_HARVESTED = 4;

const FEEDISH_HREF = /\.(rss|xml)$|\/(rss|feed)s?(\/|$)/i;

/**
 * Bir sayfanın gövdesindeki feed'e benzeyen <a href> adreslerini toplar.
 *
 * Yalnızca yoklama sırasında feed olmadığı anlaşılan sayfalarda kullanılır:
 * /rss çoğu zaman bir feed değil, feed'leri listeleyen bir sayfa. Ölçümde
 * NTV böyle kaçmıştı — akışları /son-dakika.rss gibi adreslerde ve sayfada
 * <link rel=alternate> yok, düz bağlantı var.
 *
 * Kasten dar: uzantı ya da yol feed'e benzemek zorunda, ve sayı sınırlı.
 */
export function harvestFeedHrefs(html: string, baseUrl: string): FeedLink[] {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ");
  const found: FeedLink[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(/<a\b[^>]*\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
    const raw = match[1] ?? "";
    const href = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;

    if (!FEEDISH_HREF.test(href)) {
      continue;
    }

    const url = resolveHref(href, baseUrl);

    if (!url) {
      continue;
    }

    const key = canonicalUrl(url);

    // Sayfanın kendisine dönen bağlantı işe yaramaz.
    if (seen.has(key) || key === canonicalUrl(baseUrl)) {
      continue;
    }

    seen.add(key);
    found.push({ url, title: null, via: "probe" });

    if (found.length >= MAX_HARVESTED) {
      break;
    }
  }

  return found;
}

/**
 * <link> etiketi yoksa denenecek yollar. Sıra önemli: en yaygın olan önce,
 * çünkü yoklama erken çıkışlı ve site başına istek sayısı sınırlı.
 */
export function probePaths(siteUrl: string): string[] {
  let parsed: URL;

  try {
    parsed = new URL(siteUrl);
  } catch {
    return [];
  }

  const origin = parsed.origin;

  const paths = [
    "/feed",
    "/rss",
    "/feed.xml",
    "/rss.xml",
    "/atom.xml",
    "/index.xml",
    // Blogspot; mevcut preset'lerdeki birkaç kaynak bu şekilde.
    "/feeds/posts/default",
    // WordPress'in sorgu dizeli biçimi.
    "/?feed=rss2",
    "/blog/feed",
  ];

  // Adres bir bölüm içeriyorsa (site.com/haberler/x) o bölümün kendi akışı
  // olabilir.
  const section = parsed.pathname.split("/").filter(Boolean)[0];

  if (section) {
    paths.push(`/${section}/feed`, `/${section}/rss`);
  }

  const urls = paths.map((path) => `${origin}${path}`);

  return [...new Set(urls)];
}

/**
 * Ucuz kapı: xml2js'e para ödemeden önce gövdenin feed'e benzeyip
 * benzemediğine bak. Asıl işi, "200 OK dönen ama HTML olan" yumuşak 404'leri
 * elemek — yoklamanın açık ara en yaygın başarısızlığı bu.
 */
export function looksLikeFeedXml(text: string): boolean {
  const head = text
    .replace(/^﻿/, "")
    .trimStart()
    .replace(/^<\?xml[^>]*\?>/i, "")
    .replace(/^<!DOCTYPE[^>]*>/i, "")
    .trimStart()
    .slice(0, 2048)
    .toLowerCase();

  return (
    head.startsWith("<rss") ||
    head.startsWith("<feed") ||
    head.startsWith("<rdf:rdf")
  );
}

/**
 * Çıplak & karakterini onarır. Gerçek dünyadaki feed'lerin azımsanmayacak
 * bir kısmında var ve xml2js bunlara hata veriyor. Yalnızca ilk parse
 * denemesi başarısız olduğunda çağrılır.
 */
export function repairXml(xml: string): string {
  return xml.replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, "&amp;");
}
