import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { Issue, Item } from "../types.js";
import { formatDate } from "../util/date.js";
import { domainOf } from "../util/url.js";

const distDir = fileURLToPath(new URL("../../dist/", import.meta.url));

/** Her alan kendi klasorune yazar; sayfalar ve RSS akislari karismaz. */
function presetDistDir(presetId: string): string {
  return path.join(distDir, presetId);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLES = `
:root {
  --paper: #faf9f7;
  --surface: #ffffff;
  --ink: #16161a;
  --muted: #6b6f78;
  --line: #e7e3dc;
  --accent: #c8412a;
  --accent-soft: #fdf1ed;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #121316;
    --surface: #1a1b1f;
    --ink: #eceef2;
    --muted: #979ba5;
    --line: #2b2d33;
    --accent: #ff7d5e;
    --accent-soft: #241a18;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 48px 20px 80px; }
a { color: inherit; }
header.masthead { border-bottom: 2px solid var(--ink); padding-bottom: 14px; }
.wordmark {
  font-size: 13px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase; text-decoration: none; display: inline-block;
}
.wordmark .dot { color: var(--accent); }
.masthead .tagline { color: var(--muted); font-size: 13px; margin-top: 2px; }
.issue-meta {
  display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline;
  margin: 18px 0 0; font-size: 13px; color: var(--muted);
}
.issue-no { color: var(--accent); font-weight: 700; letter-spacing: 0.06em; }
.lede {
  font-size: 19px; line-height: 1.6; margin: 32px 0 40px;
  font-family: Georgia, "Times New Roman", serif;
}
.label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--accent);
}
.highlight {
  background: var(--accent-soft); border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 4px; padding: 22px 24px; margin-bottom: 44px;
}
.highlight h2 { font-size: 22px; line-height: 1.3; margin: 10px 0 8px; }
h2.section {
  font-size: 12px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted);
  border-bottom: 1px solid var(--line); padding-bottom: 8px;
  margin: 44px 0 8px;
}
article.item { padding: 22px 0; border-bottom: 1px solid var(--line); }
article.item h3 { font-size: 18px; line-height: 1.35; margin: 0 0 6px; font-weight: 600; }
article.item h3 a { text-decoration: none; }
article.item h3 a:hover { color: var(--accent); text-decoration: underline; }
.meta { font-size: 12.5px; color: var(--muted); margin-bottom: 10px; }
.meta .src { font-weight: 600; color: var(--ink); }
.tldr { margin: 0 0 10px; }
.matters {
  margin: 0; padding-left: 12px; border-left: 2px solid var(--line);
  font-size: 14.5px; color: var(--muted);
}
.tags { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.tag {
  font-size: 11px; letter-spacing: 0.04em; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px;
  background: var(--surface);
}
footer.colophon {
  margin-top: 56px; padding-top: 22px; border-top: 2px solid var(--ink);
  font-size: 13px; color: var(--muted);
}
.stats { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 16px; }
.stat strong { display: block; color: var(--ink); font-size: 19px; line-height: 1.2; }
.stat span { font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; }
.archive-row {
  display: block; text-decoration: none; padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.archive-row:hover h3 { color: var(--accent); }
.archive-row.pending { opacity: 0.55; }
.archive-row.pending:hover h3 { color: inherit; }
.archive-row h3 { margin: 4px 0 6px; font-size: 18px; }
.archive-row p { margin: 0; color: var(--muted); font-size: 14px; }
@media (max-width: 480px) {
  .wrap { padding: 32px 16px 60px; }
  .lede { font-size: 17px; }
}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`;
}

function masthead(config: Config, href: string): string {
  return `<header class="masthead">
  <a class="wordmark" href="${href}">${escapeHtml(config.title)}<span class="dot">.</span></a>
  <div class="tagline">${escapeHtml(config.tagline)}</div>
</header>`;
}

function itemMeta(item: Item, language: string): string {
  const parts = [`<span class="src">${escapeHtml(item.source)}</span>`];

  if (item.publishedAt) {
    parts.push(escapeHtml(formatDate(item.publishedAt, language)));
  }

  parts.push(escapeHtml(domainOf(item.url)));

  if (item.points !== null) {
    parts.push(`${item.points} puan`);
  }

  return parts.join(" &middot; ");
}

function renderTags(item: Item): string {
  if (item.tags.length === 0) {
    return "";
  }

  const tags = item.tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  return `<div class="tags">${tags}</div>`;
}

function renderItem(item: Item, language: string): string {
  return `<article class="item">
  <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h3>
  <div class="meta">${itemMeta(item, language)}</div>
  <p class="tldr">${escapeHtml(item.tldr)}</p>
  <p class="matters"><strong>Neden önemli:</strong> ${escapeHtml(item.whyItMatters)}</p>
  ${renderTags(item)}
</article>`;
}

function renderHighlight(item: Item, language: string): string {
  return `<section class="highlight">
  <div class="label">Haftanın öne çıkanı</div>
  <h2><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" style="text-decoration:none">${escapeHtml(item.title)}</a></h2>
  <div class="meta">${itemMeta(item, language)}</div>
  <p class="tldr">${escapeHtml(item.tldr)}</p>
  <p class="matters"><strong>Neden önemli:</strong> ${escapeHtml(item.whyItMatters)}</p>
  ${renderTags(item)}
</section>`;
}

export function renderIssueHtml(config: Config, issue: Issue): string {
  const highlight = issue.items.find((item) => item.id === issue.highlightId);
  const rest = issue.items.filter((item) => item.id !== issue.highlightId);

  const categories = new Map<string, Item[]>();

  for (const item of rest) {
    const bucket = categories.get(item.category) ?? [];
    bucket.push(item);
    categories.set(item.category, bucket);
  }

  const sections: string[] = [];

  for (const category of config.categories) {
    const bucket = categories.get(category);

    if (!bucket || bucket.length === 0) {
      continue;
    }

    sections.push(
      `<h2 class="section">${escapeHtml(category)}</h2>` +
        bucket.map((item) => renderItem(item, config.language)).join("\n"),
    );
  }

  const period = `${formatDate(issue.periodStart, config.language)} – ${formatDate(
    issue.periodEnd,
    config.language,
  )}`;

  const body = [
    masthead(config, "index.html"),
    `<div class="issue-meta">
      <span class="issue-no">SAYI ${issue.number} &middot; ${escapeHtml(issue.id)}</span>
      <span>${escapeHtml(period)}</span>
      <span>${issue.items.length} haber</span>
    </div>`,
    `<p class="lede">${escapeHtml(issue.intro)}</p>`,
    highlight ? renderHighlight(highlight, config.language) : "",
    sections.join("\n"),
    `<footer class="colophon">
      <div class="stats">
        <div class="stat"><strong>${issue.stats.collected}</strong><span>aday tarandı</span></div>
        <div class="stat"><strong>${issue.stats.fresh}</strong><span>yeni içerik</span></div>
        <div class="stat"><strong>${issue.stats.published}</strong><span>bültene girdi</span></div>
        <div class="stat"><strong>$${issue.usage.estimatedCostUsd.toFixed(3)}</strong><span>üretim maliyeti</span></div>
      </div>
      <p>${escapeHtml(config.title)} tarafından ${escapeHtml(
        formatDate(issue.generatedAt, config.language),
      )} tarihinde otomatik derlendi.
      <a href="index.html">Tüm sayılar &rarr;</a></p>
    </footer>`,
  ].join("\n");

  return page(`${config.title} — Sayı ${issue.number}`, body);
}

export function renderIndexHtml(
  config: Config,
  issues: readonly Issue[],
): string {
  const rows = issues
    .map((issue) => {
      const preview = issue.items
        .slice(0, 3)
        .map((item) => item.title)
        .join(" · ");

      const firstSentence = issue.intro.split(/(?<=[.!?])\s/)[0] ?? issue.id;

      return `<a class="archive-row" href="${escapeHtml(issue.id)}.html">
  <div class="label">Sayı ${issue.number} &middot; ${escapeHtml(
    formatDate(issue.periodEnd, config.language),
  )}</div>
  <h3>${escapeHtml(firstSentence)}</h3>
  <p>${escapeHtml(preview)}</p>
</a>`;
    })
    .join("\n");

  const body = [
    masthead(config, "index.html"),
    `<p class="lede">${escapeHtml(
      config.tagline,
    )}. Her sayı otomatik derleniyor: kaynaklar taranır, tekrarlar elenir, kalanlar puanlanır ve en iyileri buraya düşer.</p>`,
    `<h2 class="section">Arşiv</h2>`,
    rows || `<p>Henüz sayı yok.</p>`,
    `<p class="lede"><a href="../index.html">← Tüm alanlar</a></p>`,
  ].join("\n");

  return page(`${config.title} — Arşiv`, body);
}

/** Kapak sayfasinda bir alani temsil eden satir. */
export type HubEntry = {
  id: string;
  name: string;
  tagline: string;
  issueCount: number;
  latest: { id: string; number: number; periodEnd: string } | null;
};

/**
 * dist/index.html: uretilmis tum alanlari listeler. Her satir o alanin
 * kendi arsivine gider.
 */
export function renderHubHtml(
  entries: readonly HubEntry[],
  language: string,
): string {
  const rows = entries
    .map((entry) => {
      const inner = `  <div class="label">${
        entry.latest
          ? `Sayı ${entry.latest.number} &middot; ${escapeHtml(
              formatDate(entry.latest.periodEnd, language),
            )} &middot; ${entry.issueCount} sayı`
          : `Henüz sayı yok &middot; npm start ${escapeHtml(entry.id)}`
      }</div>
  <h3>${escapeHtml(entry.name)}</h3>
  <p>${escapeHtml(entry.tagline)}</p>`;

      // Arsivi olmayan alan icin link uretme; sayfa henuz yok.
      return entry.latest
        ? `<a class="archive-row" href="${escapeHtml(entry.id)}/index.html">\n${inner}\n</a>`
        : `<div class="archive-row pending">\n${inner}\n</div>`;
    })
    .join("\n");

  const body = [
    `<header class="masthead">
  <a class="wordmark" href="index.html">Radar<span class="dot">.</span></a>
  <div class="tagline">Haftalık bültenler</div>
</header>`,
    `<p class="lede">Her alan kendi kaynaklarını tarar, tekrarları eler ve kalanları puanlar. Bir alanı seçip arşivine göz at.</p>`,
    `<h2 class="section">Alanlar</h2>`,
    rows || `<p>Henüz alan yok.</p>`,
  ].join("\n");

  return page("Radar — Alanlar", body);
}

export function renderMarkdown(config: Config, issue: Issue): string {
  const lines: string[] = [
    `# ${config.title} — Sayı ${issue.number}`,
    "",
    `_${formatDate(issue.periodStart, config.language)} – ${formatDate(
      issue.periodEnd,
      config.language,
    )}_`,
    "",
    issue.intro,
    "",
  ];

  const highlight = issue.items.find((item) => item.id === issue.highlightId);

  if (highlight) {
    lines.push(
      "## Haftanın öne çıkanı",
      "",
      `**[${highlight.title}](${highlight.url})** — ${highlight.source}`,
      "",
      highlight.tldr,
      "",
      `> **Neden önemli:** ${highlight.whyItMatters}`,
      "",
    );
  }

  for (const category of config.categories) {
    const bucket = issue.items.filter(
      (item) => item.category === category && item.id !== issue.highlightId,
    );

    if (bucket.length === 0) {
      continue;
    }

    lines.push(`## ${category}`, "");

    for (const item of bucket) {
      lines.push(
        `**[${item.title}](${item.url})** — ${item.source}`,
        "",
        item.tldr,
        "",
        `> **Neden önemli:** ${item.whyItMatters}`,
        "",
      );
    }
  }

  lines.push(
    "---",
    "",
    `${issue.stats.collected} aday tarandı, ${issue.stats.published} haber seçildi. ${config.title} ile otomatik derlendi.`,
  );

  return lines.join("\n");
}

export function renderFeed(
  config: Config,
  issues: readonly Issue[],
  siteUrl: string,
): string {
  // Sayfalar dist/<alan>/ altinda durdugu icin akis adresleri de alan
  // klasorunu icermeli.
  const base = `${siteUrl.replace(/\/+$/, "")}/${config.id}`;

  const items = issues
    .slice(0, 20)
    .map(
      (issue) => `  <item>
    <title>${escapeHtml(`${config.title} — Sayı ${issue.number}`)}</title>
    <link>${escapeHtml(`${base}/${issue.id}.html`)}</link>
    <guid isPermaLink="false">${escapeHtml(issue.id)}</guid>
    <pubDate>${new Date(issue.generatedAt).toUTCString()}</pubDate>
    <description>${escapeHtml(issue.intro)}</description>
  </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeHtml(config.title)}</title>
  <link>${escapeHtml(base)}</link>
  <description>${escapeHtml(config.tagline)}</description>
  <language>${escapeHtml(config.language)}</language>
${items}
</channel>
</rss>
`;
}

export type RenderedPaths = {
  html: string;
  markdown: string;
  index: string;
  feed: string;
};

export async function writeOutputs(
  config: Config,
  issue: Issue,
  allIssues: readonly Issue[],
  siteUrl: string,
): Promise<RenderedPaths> {
  const outDir = presetDistDir(config.id);
  await mkdir(outDir, { recursive: true });

  const htmlPath = path.join(outDir, `${issue.id}.html`);
  const mdPath = path.join(outDir, `${issue.id}.md`);
  const indexPath = path.join(outDir, "index.html");
  const feedPath = path.join(outDir, "feed.xml");

  await writeFile(htmlPath, renderIssueHtml(config, issue), "utf8");
  await writeFile(mdPath, renderMarkdown(config, issue), "utf8");
  await writeFile(indexPath, renderIndexHtml(config, allIssues), "utf8");
  await writeFile(feedPath, renderFeed(config, allIssues, siteUrl), "utf8");

  return {
    html: htmlPath,
    markdown: mdPath,
    index: indexPath,
    feed: feedPath,
  };
}

export async function writeHub(
  entries: readonly HubEntry[],
  language: string,
): Promise<string> {
  await mkdir(distDir, { recursive: true });

  const hubPath = path.join(distDir, "index.html");
  await writeFile(hubPath, renderHubHtml(entries, language), "utf8");

  return hubPath;
}
