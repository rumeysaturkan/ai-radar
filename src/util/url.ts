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

/**
 * Tam kamu son ek listesi yerine yaygın çok parçalı uzantıların küçük bir
 * tablosu. Çeşitlilik sınırı için yeterli: amaç kesin tescil sınırını
 * bulmak değil, aynı yayıncıyı tek kova altında toplamak.
 */
const MULTI_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.tr", "org.tr", "net.tr", "gov.tr", "edu.tr",
  "co.jp", "or.jp", "ne.jp",
  "com.au", "net.au", "org.au",
  "com.br", "com.cn", "com.mx", "com.sg", "com.hk",
  "co.nz", "co.in", "co.za", "co.kr",
]);

/**
 * Yayıncı kimliği: finance.yahoo.com ve sg.finance.yahoo.com aynı kovaya
 * düşsün. Alt alan adı üzerinden bir çeşitlilik sınırı, tek yayıncının
 * birden fazla alt alanla sınırı aşmasına izin verirdi.
 */
export function registrableDomain(rawUrl: string): string {
  const host = domainOf(rawUrl);
  const parts = host.split(".");

  if (parts.length <= 2) {
    return host;
  }

  const lastTwo = parts.slice(-2).join(".");

  return MULTI_PART_TLDS.has(lastTwo)
    ? parts.slice(-3).join(".")
    : lastTwo;
}
