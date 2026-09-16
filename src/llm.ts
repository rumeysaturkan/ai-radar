import "dotenv/config";
import OpenAI from "openai";
import type { StageUsage, Usage } from "./types.js";
import { warn } from "./util/log.js";

let cachedClient: OpenAI | null = null;

/** Anahtar kurulum adiminda girilebildigi icin istemci tembel kurulur. */
function client(): OpenAI {
  cachedClient ??= new OpenAI();
  return cachedClient;
}

/**
 * 1M token başına USD. Başka bir model seçersen buraya bir satır ekle;
 * eklemezsen maliyet eksik raporlanır ve çalışma sonunda uyarı basılır.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.2": { input: 1.75, output: 14 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** Sürüm sabitlenmiş model adları (gpt-5-mini-2025-08-07) taban fiyata düşer. */
function priceOf(model: string): { input: number; output: number } | undefined {
  return PRICING[model] ?? PRICING[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
}

/**
 * Maliyetin hangi adımda oluştuğu, projenin merkezi iddiasının kanıtı:
 * ucuz model yüzlerce adaya, pahalı model yalnızca son on ikiye dokunuyor.
 * Tek bir toplam rakam bunu göstermiyordu.
 */
export type Stage = "score" | "enrich" | "compose" | "discovery" | "research";

export type UsageLedger = {
  record(
    stage: Stage,
    model: string,
    usage: OpenAI.CompletionUsage | undefined,
  ): void;
  byStage(): StageUsage[];
  totals(): Usage;
  unpricedModels(): string[];
};

/**
 * Her çalıştırma kendi defterini tutabilir. Modül seviyesinde tek bir sayaç,
 * aynı süreçte iki bültenin birbirinin maliyetini raporlamasına yol açardı —
 * sunucu bunu yapacak.
 */
export function createLedger(): UsageLedger {
  const rows = new Map<string, StageUsage>();

  return {
    record(stage, model, usage) {
      if (!usage) {
        return;
      }

      const key = `${stage}:${model}`;
      const price = priceOf(model);

      let row = rows.get(key);

      if (!row) {
        row = {
          stage,
          model,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          priced: price !== undefined,
        };
        rows.set(key, row);
      }

      row.calls += 1;
      row.inputTokens += usage.prompt_tokens;
      row.outputTokens += usage.completion_tokens;

      if (price) {
        row.estimatedCostUsd +=
          (usage.prompt_tokens / 1_000_000) * price.input +
          (usage.completion_tokens / 1_000_000) * price.output;
      }
    },

    byStage() {
      return [...rows.values()]
        .map((row) => ({
          ...row,
          estimatedCostUsd: Number(row.estimatedCostUsd.toFixed(4)),
        }))
        .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
    },

    totals() {
      let inputTokens = 0;
      let outputTokens = 0;
      let costUsd = 0;

      for (const row of rows.values()) {
        inputTokens += row.inputTokens;
        outputTokens += row.outputTokens;
        costUsd += row.estimatedCostUsd;
      }

      return {
        inputTokens,
        outputTokens,
        estimatedCostUsd: Number(costUsd.toFixed(4)),
        stages: this.byStage(),
      };
    },

    unpricedModels() {
      return [
        ...new Set(
          [...rows.values()].filter((row) => !row.priced).map((row) => row.model),
        ),
      ].sort();
    },
  };
}

const defaultLedger = createLedger();

export function usageSoFar(): Usage {
  return defaultLedger.totals();
}

export function unpricedModels(): string[] {
  return defaultLedger.unpricedModels();
}

/**
 * Akıl yürütme bütçesi. GPT-5 ailesi varsayılan olarak görünmez "reasoning"
 * token'ı üretiyor ve bunlar çıktı token'ı olarak faturalanıyor. Bu hattaki
 * işler — bir başlığı puanlamak, bir yazıyı iki cümleye indirmek — derin akıl
 * yürütme gerektirmiyor.
 *
 * Desteklenen değerler modele göre değişiyor: gpt-5.1 "none" kabul edip
 * "minimal" reddediyor, gpt-5-mini tam tersi. "low" ikisinde de çalışıyor,
 * varsayılan o. Desteklenmeyen bir değer verilirse ayar düşürülüp çağrı
 * tekrarlanır — yanlış bir ayar bütün bülteni düşürmesin.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

function rejectsReasoningEffort(error: unknown): boolean {
  return (
    error instanceof Error &&
    /reasoning_effort/.test(error.message) &&
    /[Uu]nsupported|invalid/.test(error.message)
  );
}

export type StructuredRequest = {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Maliyetin hangi adımda oluştuğunu kaydetmek için zorunlu. */
  stage: Stage;
  reasoningEffort?: ReasoningEffort;
  /** Verilmezse süreç geneli defter kullanılır. */
  ledger?: UsageLedger;
};

/**
 * Modelden JSON şemasına birebir uyan bir cevap ister. Ürünün her hafta aynı
 * şekilli çıktı vermesinin sebebi bu: serbest metin yerine sözleşme.
 */
export async function structured<T>(request: StructuredRequest): Promise<T> {
  const ledger = request.ledger ?? defaultLedger;
  let effort = request.reasoningEffort;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client().chat.completions.create({
        model: request.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        ...(effort ? { reasoning_effort: effort } : {}),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      });

      ledger.record(request.stage, request.model, response.usage);

      const content = response.choices[0]?.message.content;

      if (!content) {
        throw new Error("Model boş cevap döndü");
      }

      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error;

      // Bu model bu akıl yürütme ayarını kabul etmiyor. Ayarı düşürüp bir kez
      // daha dene; yanlış bir yapılandırma değeri bülteni komple düşürmesin.
      if (effort && rejectsReasoningEffort(error)) {
        warn(
          `${request.model} "reasoningEffort: ${effort}" değerini kabul etmedi; ` +
            "ayar yok sayılıyor.",
        );
        effort = undefined;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export async function verifyApiKey(): Promise<void> {
  await client().models.list();
}
