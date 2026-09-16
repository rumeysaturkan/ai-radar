const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
];

const SAFE_SCHEMES = new Set(["http:", "https:"]);

/**
 * Beslemeden gelen adresler güvenilmez veridir. `"http"` ile başlıyor mu
 * kontrolü `httpx://` gibi şemaları da geçirir, bu yüzden şema gerçekten
 * çözümlenerek kontrol edilir.
 */
export function isHttpUrl(rawUrl: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

/**
 * href'e konulabilecek bir adres ya da null döner. escapeHtml bir
 * `javascript:` şemasının tıklandığında çalışmasını engellemez; bağlantıyı
 * hiç üretmemek tek güvenli davranış.
 */
export function safeHref(rawUrl: string): string | null {
  return isHttpUrl(rawUrl) ? rawUrl : null;
}

/**
 * Aynı içeriğin farklı adreslerini tek forma indirger; tekilleştirmenin
 * temeli budur.
 */
export function canonicalUrl(rawUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim().toLowerCase();
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.protocol = "https:";

  for (const param of TRACKING_PARAMS) {
    parsed.searchParams.delete(param);
  }

  parsed.search = parsed.searchParams.toString()
    ? `?${parsed.searchParams.toString()}`
    : "";

  const pathname =
    parsed.pathname.length > 1
      ? parsed.pathname.replace(/\/+$/, "")
      : parsed.pathname;

  return `${parsed.protocol}//${parsed.hostname}${pathname}${parsed.search}`;
}

export function domainOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}
