import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeProblems, SAFE_ID, validateConfig } from "./config-validate.js";
import type { ReasoningEffort } from "./llm.js";
import { warn } from "./util/log.js";

export type Feed = {
  name: string;
  url: string;
  max?: number;
};

export type Config = {
  id: string;
  name: string;
  title: string;
  tagline: string;
  language: string;
  siteUrl: string;
  audience: string;
  topics: string[];
  categories: string[];
  windowDays: number;
  candidateLimit: number;
  maxPerSource: number;
  shortlist: number;
  minScore: number;
  models: { scorer: string; writer: string };
  reasoningEffort: ReasoningEffort;
  feeds: Feed[];
  hackerNews: { enabled: boolean; minPoints: number; queries: string[] };
  webSearch: { enabled: boolean; queries: string[] };
};

const defaults: Omit<Config, "id" | "name"> = {
  title: "Radar",
  tagline: "Haftalık bülten",
  language: "tr",
  siteUrl: "",
  audience: "Teknik okuyucular",
  topics: [],
  categories: ["Genel"],
  windowDays: 7,
  candidateLimit: 160,
  maxPerSource: 12,
  shortlist: 12,
  minScore: 6,
  models: { scorer: "gpt-5-mini", writer: "gpt-5.1" },
  reasoningEffort: "low",
  feeds: [],
  hackerNews: { enabled: false, minPoints: 100, queries: [] },
  webSearch: { enabled: false, queries: [] },
};

export const presetsDir = fileURLToPath(new URL("../presets/", import.meta.url));

export type PresetSummary = {
  id: string;
  name: string;
  tagline: string;
  feedCount: number;
};

export function presetPath(id: string): string {
  return path.join(presetsDir, `${id}.json`);
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(
      `Geçersiz alan kimliği: "${id}". Yalnızca küçük harf, rakam ve tire kullanılabilir.`,
    );
  }
}

export async function listPresets(): Promise<PresetSummary[]> {
  let files: string[];

  try {
    files = await readdir(presetsDir);
  } catch {
    return [];
  }

  const summaries: PresetSummary[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const id = file.slice(0, -".json".length);

    try {
      const parsed = JSON.parse(
        await readFile(path.join(presetsDir, file), "utf8"),
      ) as Partial<Config>;

      summaries.push({
        id,
        name: parsed.name ?? id,
        tagline: parsed.tagline ?? defaults.tagline,
        feedCount: parsed.feeds?.length ?? 0,
      });
    } catch {
    }
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function loadConfig(id: string): Promise<Config> {
  assertSafeId(id);

  let raw: string;

  try {
    raw = await readFile(presetPath(id), "utf8");
  } catch {
    throw new Error(
      `"${id}" alanı bulunamadı. presets/${id}.json dosyası yok.`,
    );
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `presets/${id}.json okunamadı (geçersiz JSON): ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const { problems, warnings } = validateConfig(parsedJson, id);

  if (problems.length > 0) {
    throw new Error(describeProblems(id, problems));
  }

  for (const warning of warnings) {
    warn(warning);
  }

  const parsed = parsedJson as Partial<Config>;

  return {
    ...defaults,
    ...parsed,
    id,
    name: parsed.name ?? id,
    models: { ...defaults.models, ...parsed.models },
    hackerNews: { ...defaults.hackerNews, ...parsed.hackerNews },
    webSearch: { ...defaults.webSearch, ...parsed.webSearch },
  };
}
