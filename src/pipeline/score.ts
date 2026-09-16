import type { Config } from "../config.js";
import { structured } from "../llm.js";
import type { Candidate, ScoredCandidate } from "../types.js";
import { outputLanguageRule } from "../i18n.js";
import { isoWeekId } from "../util/date.js";
import { mapWithConcurrency } from "../util/pool.js";
import { shuffle } from "../util/shuffle.js";
import { warn } from "../util/log.js";

const BATCH_SIZE = 30;

type Rating = {
  index: number;
  score: number;
  category: string;
  reason: string;
};

export type ScoreOptions = {
  /**
   * Grup karıştırmasının tohumu. Sayının kimliği veriliyor: aynı hafta
   * tekrar çalıştırıldığında sonuç değişmez.
   */
  seed?: string;
};

export type ScoreDeps = {
  structured: typeof structured;
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Puanlama tek eksende kalıyor. impact/novelty diye iki 0-5 ekseni denendi ve
 * aynı 84 aday üzerinde ölçüldü: ayrı puan seviyesi 10'dan 9'a düştü, tepe
 * sıkıştı (en yüksek 9 yerine 8) ve kesimdeki belirsizlik birebir aynı kaldı.
 * Kazanmadığı için tutulmadı.
 *
 * Ölçümün asıl gösterdiği şu: her iki şemada da kısa listenin 12 yerinden 8'i
 * eşit puanlı adaylar arasından seçiliyor. Yani ayırt etme işini puan değil,
 * select.ts'teki eşitlik bozma kuralı yapıyor. Bunu puanlayıcı tarafında
 * çözmenin yolu daha ince bir ölçek değil, en iyi ~25 aday için ikinci bir
 * *sıralama* çağrısı olurdu — mutlak puanlama yerine göreli karşılaştırma.
 */
function systemPrompt(config: Config): string {
  return [
    `You are the editor of a weekly briefing called "${config.title}".`,
    `Your readers: ${config.audience}.`,
    "Topics you care about:",
    ...config.topics.map((topic) => `- ${topic}`),
    "",
    "You will be given candidate stories. Score each one from 0 to 10:",
    "- 9-10: genuinely shifts the field; everyone in this audience should know",
    '     e.g. "Language X now enforces memory safety in the compiler"',
    "- 7-8: a concrete tool, release or change the reader can act on",
    '     e.g. "Library Y 3.0 ships and the old API is gone"',
    "- 4-6: interesting but not important",
    '     e.g. "Company Z formed a research team"',
    "- 0-3: advertising, speculation, content marketing, a repeat, irrelevant",
    '     e.g. "The 10 best tools of 2026"',
    "",
    "Judge the substance, not the headline. Announcements of intent such as",
    '"Company X will invest in this area" score low. You are not told who',
    "published an item; decide on the content alone.",
    "Give the reason in one sentence.",
    outputLanguageRule(config.language),
  ].join("\n");
}

export async function scoreCandidates(
  config: Config,
  candidates: readonly Candidate[],
  options: ScoreOptions = {},
  deps: ScoreDeps = { structured },
): Promise<ScoredCandidate[]> {
  // Adaylar kaynak sırasında geliyor. Karıştırmadan gruplara bölünürse
  // gruplar arası kalibrasyon farkı doğrudan besleme sırasıyla hizalanır.
  const seed = options.seed ?? isoWeekId(new Date());
  const batches = chunk(shuffle(candidates, seed), BATCH_SIZE);

  const schema = {
    type: "object",
    properties: {
      ratings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            score: { type: "integer" },
            category: { type: "string", enum: config.categories },
            reason: { type: "string" },
          },
          required: ["index", "score", "category", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["ratings"],
    additionalProperties: false,
  };

  const scoredBatches = await mapWithConcurrency(
    batches,
    3,
    async (batch): Promise<ScoredCandidate[]> => {
      // Kaynak adı kasıtlı olarak verilmiyor: model içeriği yargılamadan
      // önce markayı öğrenmesin.
      const payload = batch.map((candidate, index) => ({
        index,
        title: candidate.title,
        snippet: candidate.snippet.slice(0, 300),
      }));

      try {
        const response = await deps.structured<{ ratings: Rating[] }>({
          model: config.models.scorer,
          system: systemPrompt(config),
          user: `Adaylar:\n${JSON.stringify(payload, null, 1)}`,
          schemaName: "ratings",
          schema,
          stage: "score",
          reasoningEffort: config.reasoningEffort,
        });

        const scored: ScoredCandidate[] = [];

        for (const rating of response.ratings) {
          const candidate = batch[rating.index];

          if (!candidate) {
            continue;
          }

          scored.push({
            ...candidate,
            // Şema tam sayı garantiliyor ama aralığı değil.
            score: clamp(rating.score, 0, 10),
            reason: rating.reason,
            category: rating.category,
          });
        }

        return scored;
      } catch (error) {
        warn(
          `Bir puanlama grubu atlandı: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [];
      }
    },
  );

  return scoredBatches.flat().sort((a, b) => b.score - a.score);
}
