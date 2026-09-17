import type { Config, Feed } from "./config.js";
import { ui } from "./i18n.js";
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
    problems.push(
      ui(
        {
          tr: '"{field}" boş olmayan bir metin olmalı.',
          en: '"{field}" must be a non-empty string.',
        },
        { field },
      ),
    );
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
      typeof value === "string"
        ? ui(
            {
              tr: '"{field}" bir tam sayı olmalı — tırnak içinde yazılmış.',
              en: '"{field}" must be a whole number — it is written in quotes.',
            },
            { field },
          )
        : ui(
            {
              tr: '"{field}" bir tam sayı olmalı.',
              en: '"{field}" must be a whole number.',
            },
            { field },
          ),
    );
    return;
  }

  if (value < min || value > max) {
    problems.push(
      ui(
        {
          tr: '"{field}" {min} ile {max} arasında olmalı ({value} verildi).',
          en: '"{field}" must be between {min} and {max} ({value} given).',
        },
        { field, min, max, value },
      ),
    );
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
    problems.push(
      ui(
        { tr: '"{field}" bir dizi olmalı.', en: '"{field}" must be an array.' },
        { field },
      ),
    );
    return null;
  }

  const bad = value.filter(
    (entry) => typeof entry !== "string" || entry.trim() === "",
  );

  if (bad.length > 0) {
    problems.push(
      ui(
        {
          tr: '"{field}" yalnızca boş olmayan metinler içerebilir.',
          en: '"{field}" may only contain non-empty strings.',
        },
        { field },
      ),
    );
    return null;
  }

  return value as string[];
}

function checkFeeds(value: unknown, problems: string[]): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    problems.push(
      ui({ tr: '"feeds" bir dizi olmalı.', en: '"feeds" must be an array.' }),
    );
    return;
  }

  const names = new Map<string, number>();

  value.forEach((entry: unknown, index: number) => {
    const where = `feeds[${index}]`;

    if (!isRecord(entry)) {
      problems.push(
        ui(
          { tr: '{where} bir nesne olmalı.', en: '{where} must be an object.' },
          { where },
        ),
      );
      return;
    }

    const feed = entry as Partial<Feed>;

    if (typeof feed.name !== "string" || feed.name.trim() === "") {
      problems.push(
        ui(
          {
            tr: '{where}.name boş olmayan bir metin olmalı.',
            en: '{where}.name must be a non-empty string.',
          },
          { where },
        ),
      );
    } else {
      names.set(feed.name, (names.get(feed.name) ?? 0) + 1);
    }

    if (typeof feed.url !== "string" || !isHttpUrl(feed.url)) {
      problems.push(
        ui(
          {
            tr: '{where}.url http(s) ile başlayan geçerli bir adres olmalı.',
            en: '{where}.url must be a valid http(s) address.',
          },
          { where },
        ),
      );
    }

    if (feed.max !== undefined) {
      checkInteger(feed.max, `${where}.max`, 1, 200, problems);
    }
  });

  for (const [name, count] of names) {
    if (count > 1) {
      problems.push(
        ui(
          {
            tr:
              '"{name}" adlı {count} besleme var. Adlar benzersiz olmalı: ' +
              "kaynak başına kota bu adla tutuluyor.",
            en:
              'There are {count} feeds named "{name}". Names must be unique: ' +
              "the per-source quota is kept under that name.",
          },
          { name, count },
        ),
      );
    }
  }
}

export function validateConfig(raw: unknown, id: string): ValidationResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return {
      problems: [
        ui({
          tr: "Preset dosyası bir JSON nesnesi olmalı.",
          en: "A preset file must be a JSON object.",
        }),
      ],
      warnings,
    };
  }

  if (!SAFE_ID.test(id)) {
    problems.push(
      ui(
        {
          tr: 'Alan kimliği "{id}" geçersiz. Yalnızca küçük harf, rakam ve tire.',
          en: 'The domain id "{id}" is invalid. Lowercase, digits and hyphens only.',
        },
        { id },
      ),
    );
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(
        ui(
          {
            tr: '"{key}" bilinmeyen bir alan, yok sayılıyor.',
            en: '"{key}" is not a known field and is ignored.',
          },
          { key },
        ),
      );
    }
  }

  for (const field of ["name", "title", "tagline", "language", "audience"]) {
    checkString(raw[field], field, problems);
  }

  if (raw.siteUrl !== undefined) {
    if (typeof raw.siteUrl !== "string") {
      problems.push(
        ui({
          tr: '"siteUrl" bir metin olmalı.',
          en: '"siteUrl" must be a string.',
        }),
      );
    } else if (raw.siteUrl.trim() !== "" && !isHttpUrl(raw.siteUrl)) {
      problems.push(
        ui({
          tr: '"siteUrl" http(s) ile başlayan tam bir adres olmalı ya da boş bırakılmalı.',
          en: '"siteUrl" must be a full http(s) address, or left empty.',
        }),
      );
    }
  }

  const topics = checkStringArray(raw.topics, "topics", problems);

  if (topics && topics.length === 0) {
    problems.push(
      ui({
        tr: '"topics" boş olamaz: puanlama neyi eleyeceğini bilemez.',
        en: '"topics" cannot be empty: scoring has nothing to cut on.',
      }),
    );
  }

  const categories = checkStringArray(raw.categories, "categories", problems);

  if (categories) {
    if (categories.length === 0) {
      problems.push(
        ui({
          tr: '"categories" en az bir başlık içermeli.',
          en: '"categories" must contain at least one heading.',
        }),
      );
    }

    if (categories.length > 8) {
      problems.push(
        ui(
          {
            tr:
              '"categories" en fazla 8 olmalı ({count} verildi). ' +
              "Uzun liste puanlamayı zorlaştırıyor.",
            en:
              '"categories" may hold at most 8 ({count} given). ' +
              "A long list makes scoring harder.",
          },
          { count: categories.length },
        ),
      );
    }

    const seen = new Set<string>();

    for (const category of categories) {
      const key = category.toLocaleLowerCase("tr");

      if (seen.has(key)) {
        problems.push(
          ui(
            {
              tr: '"categories" içinde tekrar eden başlık: "{category}".',
              en: '"categories" repeats a heading: "{category}".',
            },
            { category },
          ),
        );
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
      problems.push(
        ui({
          tr: '"models" bir nesne olmalı.',
          en: '"models" must be an object.',
        }),
      );
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
      ui(
        {
          tr: '"reasoningEffort" şunlardan biri olmalı: {list}.',
          en: '"reasoningEffort" must be one of: {list}.',
        },
        { list: REASONING_EFFORTS.join(", ") },
      ),
    );
  }

  checkFeeds(raw.feeds, problems);

  if (raw.hackerNews !== undefined) {
    if (!isRecord(raw.hackerNews)) {
      problems.push(
        ui({
          tr: '"hackerNews" bir nesne olmalı.',
          en: '"hackerNews" must be an object.',
        }),
      );
    } else {
      if (
        raw.hackerNews.enabled !== undefined &&
        typeof raw.hackerNews.enabled !== "boolean"
      ) {
        problems.push(
          ui({
            tr: '"hackerNews.enabled" true ya da false olmalı.',
            en: '"hackerNews.enabled" must be true or false.',
          }),
        );
      }

      checkInteger(raw.hackerNews.minPoints, "hackerNews.minPoints", 0, 10_000, problems);
      checkStringArray(raw.hackerNews.queries, "hackerNews.queries", problems);
    }
  }

  if (raw.webSearch !== undefined) {
    if (!isRecord(raw.webSearch)) {
      problems.push(
        ui({
          tr: '"webSearch" bir nesne olmalı.',
          en: '"webSearch" must be an object.',
        }),
      );
    } else {
      if (
        raw.webSearch.enabled !== undefined &&
        typeof raw.webSearch.enabled !== "boolean"
      ) {
        problems.push(
          ui({
            tr: '"webSearch.enabled" true ya da false olmalı.',
            en: '"webSearch.enabled" must be true or false.',
          }),
        );
      }

      checkStringArray(raw.webSearch.queries, "webSearch.queries", problems);
    }
  }

  const hasFeeds = Array.isArray(raw.feeds) && raw.feeds.length > 0;
  const hasHn = isRecord(raw.hackerNews) && raw.hackerNews.enabled === true;
  const hasSearch = isRecord(raw.webSearch) && raw.webSearch.enabled === true;

  if (!hasFeeds && !hasHn && !hasSearch) {
    problems.push(
      ui({
        tr: "Hiç kaynak yok: en az bir besleme ekle ya da hackerNews/webSearch aç.",
        en: "No sources at all: add a feed, or turn on hackerNews/webSearch.",
      }),
    );
  }

  return { problems, warnings };
}

export function describeProblems(id: string, problems: readonly string[]): string {
  return [
    ui(
      {
        tr: "presets/{id}.json geçerli değil:",
        en: "presets/{id}.json is not valid:",
      },
      { id },
    ),
    ...problems.map((problem) => `  - ${problem}`),
  ].join("\n");
}

export type { Config };
