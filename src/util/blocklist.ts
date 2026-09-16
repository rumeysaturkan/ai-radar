import { domainOf } from "./url.js";

/**
 * Bülten kaynağı olmayan ama aramada sürekli öne çıkan yerler.
 *
 * İki yerde kullanılıyor: keşif aday siteleri elerken, ve hat web araması
 * sonuçlarını alırken. İkincisi olmadan bir LinkedIn gönderisi bültene haber
 * diye giriyordu — RSS beslemeleri bu sorunu yaşamıyor çünkü zaten seçilmiş
 * yayınlar, ama arama sonuçları açık uçlu.
 */
const BLOCKED = new Set([
  "twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com",
  "youtube.com", "tiktok.com", "reddit.com", "pinterest.com", "threads.net",
  "wikipedia.org", "wikimedia.org",
  "amazon.com", "ebay.com", "etsy.com", "aliexpress.com",
  "quora.com", "slideshare.net", "scribd.com", "issuu.com",
  "google.com", "bing.com", "yahoo.com",
]);

export function isBlockedSource(rawUrl: string): boolean {
  const host = domainOf(rawUrl);

  for (const blocked of BLOCKED) {
    if (host === blocked || host.endsWith(`.${blocked}`)) {
      return true;
    }
  }

  return false;
}
