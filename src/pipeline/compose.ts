import type { Config } from "../config.js";
import { outputLanguageRule } from "../i18n.js";
import { structured } from "../llm.js";
import type { Issue, Item } from "../types.js";

export type Composition = {
  intro: string;
  highlightIndex: number;
  categoryOrder: string[];
};

export async function composeIssue(
  config: Config,
  items: readonly Item[],
  previous: Issue | undefined,
): Promise<Composition> {
  const schema = {
    type: "object",
    properties: {
      intro: { type: "string" },
      highlightIndex: { type: "integer" },
      categoryOrder: {
        type: "array",
        items: { type: "string", enum: config.categories },
      },
    },
    required: ["intro", "highlightIndex", "categoryOrder"],
    additionalProperties: false,
  };

  const payload = items.map((item, index) => ({
    index,
    title: item.title,
    category: item.category,
    score: item.score,
    tldr: item.tldr,
  }));

  const previousBlock = previous
    ? [
        "",
        `The previous issue (${previous.id}) carried:`,
        ...previous.items.map((item) => `- ${item.title}`),
      ].join("\n")
    : "";

  const composition = await structured<Composition>({
    model: config.models.writer,
    system: [
      `You are the chief editor of the weekly briefing "${config.title}".`,
      `Your readers: ${config.audience}.`,
      "",
      "Look at this week's stories and produce:",
      "- intro: 2-3 sentences naming the week's through-line. Do not list the",
      "  stories one by one. Open on the substance, not on a formula like",
      '  "this week in X". If something continues from the previous issue,',
      "  say so.",
      "- highlightIndex: the index of the week's standout story.",
      "- categoryOrder: the categories ordered from most to least important",
      "  for this reader. Only include categories present in the list.",
      "",
      "Write plainly and directly.",
      outputLanguageRule(config.language),
    ].join("\n"),
    user: `This week's stories:\n${JSON.stringify(payload, null, 1)}${previousBlock}`,
    schemaName: "composition",
    schema,
    stage: "compose",
    reasoningEffort: config.reasoningEffort,
  });

  const present = new Set(items.map((item) => item.category));

  const ordered = composition.categoryOrder.filter((category) =>
    present.has(category),
  );

  for (const category of present) {
    if (!ordered.includes(category)) {
      ordered.push(category);
    }
  }

  return {
    intro: composition.intro,
    highlightIndex:
      composition.highlightIndex >= 0 && composition.highlightIndex < items.length
        ? composition.highlightIndex
        : 0,
    categoryOrder: ordered,
  };
}
