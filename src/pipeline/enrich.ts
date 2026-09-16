import type { Config } from "../config.js";
import { structured } from "../llm.js";
import { outputLanguageRule } from "../i18n.js";
import { readSource } from "../tools/read-source.js";
import type { Item, ScoredCandidate } from "../types.js";
import { mapWithConcurrency } from "../util/pool.js";
import { warn } from "../util/log.js";

/** Model girdisini token limitleri içinde tutmak için sayfa metni kırpılır. */
const MAX_SOURCE_CHARS = 6000;

type Summary = {
  tldr: string;
  whyItMatters: string;
  tags: string[];
};

const schema = {
  type: "object",
  properties: {
    tldr: { type: "string" },
    whyItMatters: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["tldr", "whyItMatters", "tags"],
  additionalProperties: false,
};

function systemPrompt(config: Config): string {
  return [
    `You write the weekly briefing "${config.title}".`,
    `Your readers: ${config.audience}.`,
    "",
    "You will be given a story's headline and the text of its page. Produce:",
    "- tldr: at most 2 sentences saying concretely what happened. Keep hard",
    "  details -- numbers, model names, versions, prices. Never write filler",
    '  like "an important development".',
    "- whyItMatters: one sentence on the practical consequence for these readers.",
    "- tags: 2-4 short labels using the story's own terms. Do not copy the",
    "  topic headings verbatim.",
    "",
    "If the text does not say something, do not invent it -- work with what is",
    "there.",
    outputLanguageRule(config.language),
  ].join("\n");
}

async function sourceText(item: ScoredCandidate): Promise<string> {
  try {
    const source = await readSource(item.url);

    if (source.content.length > 200) {
      return source.content.slice(0, MAX_SOURCE_CHARS);
    }
  } catch {
    // Sayfa okunamadıysa arama özetiyle devam et.
  }

  return item.snippet;
}

export async function enrichItems(
  config: Config,
  selected: readonly ScoredCandidate[],
): Promise<Item[]> {
  const enriched = await mapWithConcurrency(
    selected,
    4,
    async (candidate): Promise<Item | null> => {
      const text = await sourceText(candidate);

      try {
        const summary = await structured<Summary>({
          model: config.models.writer,
          system: systemPrompt(config),
          user: [
            `Başlık: ${candidate.title}`,
            `Kaynak: ${candidate.source}`,
            `URL: ${candidate.url}`,
            "",
            "Sayfa metni:",
            text,
          ].join("\n"),
          schemaName: "summary",
          schema,
          stage: "enrich",
          reasoningEffort: config.reasoningEffort,
        });

        return { ...candidate, ...summary };
      } catch (error) {
        warn(
          `"${candidate.title.slice(0, 50)}" özetlenemedi: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    },
  );

  return enriched.filter((item): item is Item => item !== null);
}
