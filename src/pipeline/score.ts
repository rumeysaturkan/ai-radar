import type { Config } from "../config.js";
import { structured } from "../llm.js";
import type { Candidate, ScoredCandidate } from "../types.js";
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
    `Sen "${config.title}" adlı haftalık bültenin editörüsün.`,
    `Okuyucu kitlen: ${config.audience}.`,
    "İlgilendiğin konular:",
    ...config.topics.map((topic) => `- ${topic}`),
    "",
    "Sana bir aday haber listesi verilecek. Her biri için 0-10 arası puan ver:",
    "- 9-10: sektörü gerçekten değiştiren, herkesin bilmesi gereken gelişme",
    '     örn. "X dili artık bellek güvenliğini derleyicide zorunlu kılıyor"',
    "- 7-8: okuyucunun işine doğrudan yarayacak somut haber veya araç",
    '     örn. "Y kütüphanesi 3.0 çıktı, eski API kaldırıldı"',
    "- 4-6: ilginç ama kritik değil",
    '     örn. "Z şirketi bir araştırma ekibi kurdu"',
    "- 0-3: reklam, spekülasyon, içerik pazarlaması, tekrar, alakasız",
    '     örn. "2026\'nın en iyi 10 aracı"',
    "",
    "Kurallar: Başlıktaki abartıya değil somut olguya bak. 'X şirketi bu alana",
    "yatırım yapacak' türü içi boş haberlere düşük puan ver. Bir şeyin kim",
    "tarafından yayınlandığını bilmiyorsun; yalnızca içeriğe göre karar ver.",
    "Gerekçeyi tek cümlede, Türkçe yaz.",
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
