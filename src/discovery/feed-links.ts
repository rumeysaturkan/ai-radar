import { canonicalUrl } from "../util/url.js";
import type { FeedLink } from "./types.js";

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
  return value.replace(/&amp;/gi, "&");
}

export function resolveHref(href: string, baseUrl: string): string | null {
  try {
    return new URL(decodeAmp(href.trim()), baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractFeedLinks(html: string, baseUrl: string): FeedLink[] {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ");

  const found: FeedLink[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);

    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);

    if (!rel.includes("alternate")) {
      continue;
    }

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

  return [
    ...found.filter((link) => !/comment/i.test(link.url + (link.title ?? ""))),
    ...found.filter((link) => /comment/i.test(link.url + (link.title ?? ""))),
  ];
}

const MAX_HARVESTED = 4;

const FEEDISH_HREF = /\.(rss|xml)$|\/(rss|feed)s?(\/|$)/i;

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
    "/feeds/posts/default",
    "/?feed=rss2",
    "/blog/feed",
  ];

  const section = parsed.pathname.split("/").filter(Boolean)[0];

  if (section) {
    paths.push(`/${section}/feed`, `/${section}/rss`);
  }

  const urls = paths.map((path) => `${origin}${path}`);

  return [...new Set(urls)];
}

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

export function repairXml(xml: string): string {
  return xml.replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, "&amp;");
}
