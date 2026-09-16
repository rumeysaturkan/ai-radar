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
  impact: number;
  novelty: number;
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
 * İki dar eksen, tek geniş eksenden daha iyi ayırıyor. Tek bir 0-10 puan
 * istendiğinde model adayların çoğuna 8 veriyordu; 97 adayı 12'ye indirirken
 * bu, sıralamanın ayırt etmemesi demek. 0-5'lik iki eksen modelin rahat
 * olduğu aralıkta kalıyor ve toplama kodda yapılıyor — yani test edilebilir.
 */
function systemPrompt(config: Config): string {
  return [
    `Sen "${config.title}" adlı haftalık bültenin editörüsün.`,
    `Okuyucu kitlen: ${config.audience}.`,
    "İlgilendiğin konular:",
    ...config.topics.map((topic) => `- ${topic}`),
    "",
    "Sana bir aday haber listesi verilecek. Her biri için iki ayrı eksende",
    "puan ver. Eksenleri birbirinden bağımsız değerlendir.",
    "",
    "impact (0-5) — bu gelişme okuyucunun işini ne kadar değiştirir?",
    "  5: kitlenin çalışma biçimini değiştirir",
    '     örn. "X dili artık bellek güvenliğini derleyicide zorunlu kılıyor"',
    "  3-4: doğrudan kullanabileceği somut bir araç, sürüm ya da kırıcı değişiklik",
    '     örn. "Y kütüphanesi 3.0 çıktı, eski API kaldırıldı"',
    "  1-2: bilmesi hoş ama pratikte bir şey değiştirmiyor",
    '     örn. "Z şirketi yeni bir ofis açtı"',
    "  0: bu kitleyle ilgisiz",
    "",
    "novelty (0-5) — bu gerçekten yeni bir bilgi mi?",
    "  5: beklenmedik, ilk kez duyuluyor",
    "  3-4: bilinen bir yönde atılmış somut yeni adım",
    "  1-2: zaten bilinen bir şeyin tekrarı, derleme ya da yorum",
    '     örn. "2026\'nın en iyi 10 aracı"',
    "  0: içerik pazarlaması, reklam, SEO metni",
    "",
    "Kurallar: Başlıktaki abartıya değil somut olguya bak. 'X şirketi bu alana",
    "yatırım yapacak' türü içi boş haberlerde impact düşüktür. Bir şeyin kim",
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
            impact: { type: "integer" },
            novelty: { type: "integer" },
            category: { type: "string", enum: config.categories },
            reason: { type: "string" },
          },
          required: ["index", "impact", "novelty", "category", "reason"],
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
        });

        const scored: ScoredCandidate[] = [];

        for (const rating of response.ratings) {
          const candidate = batch[rating.index];

          if (!candidate) {
            continue;
          }

          // Şema tam sayı garantiliyor ama aralığı değil.
          const impact = clamp(rating.impact, 0, 5);
          const novelty = clamp(rating.novelty, 0, 5);

          scored.push({
            ...candidate,
            score: impact + novelty,
            impact,
            novelty,
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
