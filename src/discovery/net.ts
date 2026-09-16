import Parser from "rss-parser";
import { fetchWithTimeout } from "../util/http.js";
import { decodeBody } from "./decode.js";
import type { ParsedFeed } from "./types.js";

/**
 * Keşfin tek ağ yüzeyi. Geri kalan her şey saf tutuluyor ve bu arayüz
 * enjekte edilerek test ediliyor.
 */

/** Parse edilemeyecek kadar büyük gövdeyi indirmeye devam etme. */
const MAX_BYTES = 3_000_000;

const parser = new Parser({ timeout: 15_000 });

export type FetchedPage = {
  requestedUrl: string;
  /** Yönlendirmeden sonraki adres; göreli çözümleme buna göre yapılmalı. */
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
};

export type PageFetcher = (
  url: string,
  timeoutMs?: number,
) => Promise<FetchedPage>;

export const fetchPage: PageFetcher = async (url, timeoutMs = 15_000) => {
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  const contentType = response.headers.get("content-type") ?? "";

  const declared = Number(response.headers.get("content-length") ?? "0");
  const tooBig = declared > MAX_BYTES;

  const bytes = tooBig ? new ArrayBuffer(0) : await response.arrayBuffer();
  const truncated = tooBig || bytes.byteLength > MAX_BYTES;

  return {
    requestedUrl: url,
    finalUrl: response.url || url,
    status: response.status,
    contentType,
    body: truncated ? "" : decodeBody(bytes, contentType),
    truncated,
  };
};

/**
 * parseURL değil parseString kullanılıyor: parseURL kendi fetch'ini, kendi
 * User-Agent'ını ve AbortController'sız kendi yönlendirme politikasını
 * getiriyor. Keşif zaten yanıt başlıklarına (charset, content-type) ve bayt
 * sınırına ihtiyaç duyuyor; tek bir HTTP yığını olsun.
 */
export async function parseFeedXml(xml: string): Promise<ParsedFeed> {
  const parsed = await parser.parseString(xml);

  return {
    title: parsed.title,
    link: parsed.link,
    language: (parsed as { language?: string }).language,
    items: parsed.items.map((item) => ({
      title: item.title,
      isoDate: item.isoDate,
      pubDate: item.pubDate,
      contentSnippet: item.contentSnippet,
    })),
  };
}
