import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Feed = {
  name: string;
  url: string;
  /** Bu kaynaktan bir sayida degerlendirilecek azami aday. */
  max?: number;
};

export type Config = {
  /** Dosya adiyla ayni olan kararli kimlik; cikti klasorlerini ayirir. */
  id: string;
  /** Alan secim ekraninda gorunen ad. */
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
  /**
   * GPT-5 ailesi varsayilan olarak gorunmez akil yurutme token'i uretir ve
   * bunlar cikti olarak faturalanir. Bu hattaki isler derin akil yurutme
   * gerektirmiyor; varsayilanla birakmak sayi maliyetini 7 katina cikariyor.
   */
  reasoningEffort: "minimal" | "low" | "medium" | "high";
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

const presetsDir = fileURLToPath(new URL("../presets/", import.meta.url));

export type PresetSummary = {
  id: string;
  name: string;
  tagline: string;
  feedCount: number;
};

function presetPath(id: string): string {
  return path.join(presetsDir, `${id}.json`);
}

/**
 * Dosya adi kimlik olarak kullanildigi icin disaridan gelen deger yol
 * ayiricisi veya ".." icermemeli.
 */
function assertSafeId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(
      `Geçersiz alan kimliği: "${id}". Yalnızca küçük harf, rakam ve tire kullanılabilir.`,
    );
  }
}

/** presets/ altindaki tum alanlari ada gore siralayarak dondurur. */
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
      // Bozuk bir preset diger alanlarin listelenmesini engellemesin.
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

  const parsed = JSON.parse(raw) as Partial<Config>;

  // Preset dosyasinda sadece degistirilmek istenen alan yazilabilsin.
  return {
    ...defaults,
    ...parsed,
    // Kimlik her zaman dosya adindan gelir; icerideki yazim hatasi
    // cikti klasoru ile preset dosyasini ayirmasin.
    id,
    name: parsed.name ?? id,
    models: { ...defaults.models, ...parsed.models },
    hackerNews: { ...defaults.hackerNews, ...parsed.hackerNews },
    webSearch: { ...defaults.webSearch, ...parsed.webSearch },
  };
}
