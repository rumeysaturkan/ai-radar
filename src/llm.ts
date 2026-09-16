import "dotenv/config";
import OpenAI from "openai";

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

let inputTokens = 0;
let outputTokens = 0;
let costUsd = 0;

/** Fiyat tablosunda karşılığı olmayan modeller; maliyet bunlar için eksik. */
const unpriced = new Set<string>();

export function unpricedModels(): string[] {
  return [...unpriced].sort();
}

export function usageSoFar(): {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
} {
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: Number(costUsd.toFixed(4)),
  };
}

function track(model: string, usage: OpenAI.CompletionUsage | undefined): void {
  if (!usage) {
    return;
  }

  inputTokens += usage.prompt_tokens;
  outputTokens += usage.completion_tokens;

  const price = priceOf(model);

  if (price) {
    costUsd +=
      (usage.prompt_tokens / 1_000_000) * price.input +
      (usage.completion_tokens / 1_000_000) * price.output;
  } else {
    // Sessizce 0 eklemek, bültenin altındaki maliyeti yanlış gösteriyordu.
    unpriced.add(model);
  }
}

export type StructuredRequest = {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

/**
 * Modelden JSON şemasına birebir uyan bir cevap ister. Ürünün her hafta aynı
 * şekilli çıktı vermesinin sebebi bu: serbest metin yerine sözleşme.
 */
export async function structured<T>(request: StructuredRequest): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client().chat.completions.create({
        model: request.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      });

      track(request.model, response.usage);

      const content = response.choices[0]?.message.content;

      if (!content) {
        throw new Error("Model boş cevap döndü");
      }

      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export async function verifyApiKey(): Promise<void> {
  await client().models.list();
}
