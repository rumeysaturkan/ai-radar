import { domainOf } from "./url.js";

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
