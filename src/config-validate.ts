import type { Config, Feed } from "./config.js";
import { isHttpUrl } from "./util/url.js";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"];

const KNOWN_KEYS = new Set([
  "id", "name", "title", "tagline", "language", "siteUrl", "audience",
  "topics", "categories", "windowDays", "candidateLimit", "maxPerSource",
  "shortlist", "minScore", "models", "reasoningEffort", "feeds",
  "hackerNews", "webSearch",
]);

export const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export type ValidationResult = {
  problems: string[];
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkString(
  value: unknown,
  field: string,
  problems: string[],
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`"${field}" boş olmayan bir metin olmalı.`);
  }
}

function checkInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  problems: string[],
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    problems.push(
      `"${field}" bir tam sayı olmalı` +
        (typeof value === "string" ? " — tırnak içinde yazılmış." : "."),
    );
    return;
  }

  if (value < min || value > max) {
    problems.push(`"${field}" ${min} ile ${max} arasında olmalı (${value} verildi).`);
  }
}

function checkStringArray(
  value: unknown,
  field: string,
  problems: string[],
): string[] | null {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    problems.push(`"${field}" bir dizi olmalı.`);
    return null;
  }

  const bad = value.filter(
    (entry) => typeof entry !== "string" || entry.trim() === "",
  );

  if (bad.length > 0) {
    problems.push(`"${field}" yalnızca boş olmayan metinler içerebilir.`);
    return null;
  }

  return value as string[];
}

function checkFeeds(value: unknown, problems: string[]): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    problems.push('"feeds" bir dizi olmalı.');
    return;
  }

  const names = new Map<string, number>();

  value.forEach((entry: unknown, index: number) => {
    const where = `feeds[${index}]`;

    if (!isRecord(entry)) {
      problems.push(`${where} bir nesne olmalı.`);
      return;
    }

    const feed = entry as Partial<Feed>;

    if (typeof feed.name !== "string" || feed.name.trim() === "") {
      problems.push(`${where}.name boş olmayan bir metin olmalı.`);
    } else {
      names.set(feed.name, (names.get(feed.name) ?? 0) + 1);
    }

    if (typeof feed.url !== "string" || !isHttpUrl(feed.url)) {
      problems.push(`${where}.url http(s) ile başlayan geçerli bir adres olmalı.`);
    }

    if (feed.max !== undefined) {
      checkInteger(feed.max, `${where}.max`, 1, 200, problems);
    }
  });

  for (const [name, count] of names) {
    if (count > 1) {
      problems.push(
        `"${name}" adlı ${count} besleme var. Adlar benzersiz olmalı: ` +
          "kaynak başına kota bu adla tutuluyor.",
      );
    }
  }
}

export function validateConfig(raw: unknown, id: string): ValidationResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return { problems: ["Preset dosyası bir JSON nesnesi olmalı."], warnings };
  }

  if (!SAFE_ID.test(id)) {
    problems.push(
      `Alan kimliği "${id}" geçersiz. Yalnızca küçük harf, rakam ve tire.`,
    );
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`"${key}" bilinmeyen bir alan, yok sayılıyor.`);
    }
  }

  for (const field of ["name", "title", "tagline", "language", "audience"]) {
    checkString(raw[field], field, problems);
  }

  if (raw.siteUrl !== undefined) {
    if (typeof raw.siteUrl !== "string") {
      problems.push('"siteUrl" bir metin olmalı.');
    } else if (raw.siteUrl.trim() !== "" && !isHttpUrl(raw.siteUrl)) {
      problems.push(
        '"siteUrl" http(s) ile başlayan tam bir adres olmalı ya da boş bırakılmalı.',
      );
    }
  }

  const topics = checkStringArray(raw.topics, "topics", problems);

  if (topics && topics.length === 0) {
    problems.push('"topics" boş olamaz: puanlama neyi eleyeceğini bilemez.');
  }

  const categories = checkStringArray(raw.categories, "categories", problems);

  if (categories) {
    if (categories.length === 0) {
      problems.push('"categories" en az bir başlık içermeli.');
    }

    if (categories.length > 8) {
      problems.push(
        `"categories" en fazla 8 olmalı (${categories.length} verildi). ` +
          "Uzun liste puanlamayı zorlaştırıyor.",
      );
    }

    const seen = new Set<string>();

    for (const category of categories) {
      const key = category.toLocaleLowerCase("tr");

      if (seen.has(key)) {
        problems.push(`"categories" içinde tekrar eden başlık: "${category}".`);
      }

      seen.add(key);
    }
  }

  checkInteger(raw.windowDays, "windowDays", 1, 90, problems);
  checkInteger(raw.candidateLimit, "candidateLimit", 1, 2000, problems);
  checkInteger(raw.maxPerSource, "maxPerSource", 1, 200, problems);
  checkInteger(raw.shortlist, "shortlist", 1, 100, problems);
  checkInteger(raw.minScore, "minScore", 0, 10, problems);

  if (raw.models !== undefined) {
    if (!isRecord(raw.models)) {
      problems.push('"models" bir nesne olmalı.');
    } else {
      checkString(raw.models.scorer, "models.scorer", problems);
      checkString(raw.models.writer, "models.writer", problems);
    }
  }

  if (
    raw.reasoningEffort !== undefined &&
    (typeof raw.reasoningEffort !== "string" ||
      !REASONING_EFFORTS.includes(raw.reasoningEffort))
  ) {
    problems.push(
      `"reasoningEffort" şunlardan biri olmalı: ${REASONING_EFFORTS.join(", ")}.`,
    );
  }

  checkFeeds(raw.feeds, problems);

  if (raw.hackerNews !== undefined) {
    if (!isRecord(raw.hackerNews)) {
      problems.push('"hackerNews" bir nesne olmalı.');
    } else {
      if (
        raw.hackerNews.enabled !== undefined &&
        typeof raw.hackerNews.enabled !== "boolean"
      ) {
        problems.push('"hackerNews.enabled" true ya da false olmalı.');
      }

      checkInteger(raw.hackerNews.minPoints, "hackerNews.minPoints", 0, 10_000, problems);
      checkStringArray(raw.hackerNews.queries, "hackerNews.queries", problems);
    }
  }

  if (raw.webSearch !== undefined) {
    if (!isRecord(raw.webSearch)) {
      problems.push('"webSearch" bir nesne olmalı.');
    } else {
      if (
        raw.webSearch.enabled !== undefined &&
        typeof raw.webSearch.enabled !== "boolean"
      ) {
        problems.push('"webSearch.enabled" true ya da false olmalı.');
      }

      checkStringArray(raw.webSearch.queries, "webSearch.queries", problems);
    }
  }

  const hasFeeds = Array.isArray(raw.feeds) && raw.feeds.length > 0;
  const hasHn = isRecord(raw.hackerNews) && raw.hackerNews.enabled === true;
  const hasSearch = isRecord(raw.webSearch) && raw.webSearch.enabled === true;

  if (!hasFeeds && !hasHn && !hasSearch) {
    problems.push(
      "Hiç kaynak yok: en az bir besleme ekle ya da hackerNews/webSearch aç.",
    );
  }

  return { problems, warnings };
}

export function describeProblems(id: string, problems: readonly string[]): string {
  return [
    `presets/${id}.json geçerli değil:`,
    ...problems.map((problem) => `  - ${problem}`),
  ].join("\n");
}

export type { Config };
