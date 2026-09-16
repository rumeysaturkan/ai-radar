import type { Config } from "../config.js";
import { structured } from "../llm.js";
import type { Candidate, ScoredCandidate } from "../types.js";
import { mapWithConcurrency } from "../util/pool.js";
import { warn } from "../util/log.js";

const BATCH_SIZE = 30;

type Rating = {
  index: number;
  score: number;
  category: string;
  reason: string;
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function systemPrompt(config: Config): string {
  return [
    `Sen "${config.title}" adlı haftalık bültenin editörüsün.`,
    `Okuyucu kitlen: ${config.audience}.`,
    "İlgilendiğin konular:",
    ...config.topics.map((topic) => `- ${topic}`),
    "",
    "Sana bir aday haber listesi verilecek. Her biri için 0-10 arası puan ver:",
    "- 9-10: sektörü gerçekten değiştiren, herkesin bilmesi gereken gelişme",
    "- 7-8: okuyucunun işine doğrudan yarayacak somut haber veya araç",
    "- 4-6: ilginç ama kritik değil",
    "- 0-3: reklam, spekülasyon, içerik pazarlaması, tekrar, alakasız",
    "",
    "Kurallar: Başlıktaki abartıya değil, somut olguya bak. 'X şirketi bu",
    "alana yatırım yapacak' türü içi boş haberlere düşük puan ver. Liste",
    "yazılarını ve SEO içeriklerini elemekten çekinme. Gerekçeyi tek cümlede,",
    "Türkçe yaz.",
  ].join("\n");
}

export async function scoreCandidates(
  config: Config,
  candidates: readonly Candidate[],
): Promise<ScoredCandidate[]> {
  const batches = chunk(candidates, BATCH_SIZE);

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
      const payload = batch.map((candidate, index) => ({
        index,
        title: candidate.title,
        source: candidate.source,
        snippet: candidate.snippet.slice(0, 300),
      }));

      try {
        const response = await structured<{ ratings: Rating[] }>({
          model: config.models.scorer,
          system: systemPrompt(config),
          user: `Adaylar:\n${JSON.stringify(payload, null, 1)}`,
          schemaName: "ratings",
          schema,
        });

        const scored: ScoredCandidate[] = [];

        for (const rating of response.ratings) {
          const candidate = batch[rating.index];

          if (!candidate) {
            continue;
          }

          scored.push({
            ...candidate,
            score: rating.score,
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
