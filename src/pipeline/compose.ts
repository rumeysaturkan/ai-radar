import type { Config } from "../config.js";
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

  // Önceki sayıyı vermek bülteni "canlı" yapıyor: editör süreklilik kurabiliyor.
  const previousBlock = previous
    ? [
        "",
        `Geçen sayıda (${previous.id}) şunlar vardı:`,
        ...previous.items.map((item) => `- ${item.title}`),
      ].join("\n")
    : "";

  const composition = await structured<Composition>({
    model: config.models.writer,
    system: [
      `Sen "${config.title}" haftalık bülteninin baş editörüsün.`,
      `Okuyucu kitlen: ${config.audience}.`,
      "",
      "Bu haftanın haberlerine bakıp şunları üret:",
      "- intro: 2-3 cümlelik giriş. Haftanın ana hattını söyle; haberleri tek",
      "  tek sayma. Doğrudan konuya gir, 'Bu hafta X dünyasında' türü klişe",
      "  açılış yapma. Geçen sayıya göre bir devamlılık varsa belirt.",
      "- highlightIndex: Haftanın öne çıkan haberinin index'i.",
      "- categoryOrder: Kategorileri okuyucu için en önemliden en az önemliye",
      "  sırala. Sadece listede geçen kategorileri yaz.",
      "",
      "Türkçe yaz, sade ve doğrudan bir dille.",
    ].join("\n"),
    user: `Bu haftanın haberleri:\n${JSON.stringify(payload, null, 1)}${previousBlock}`,
    schemaName: "composition",
    schema,
  });

  const present = new Set(items.map((item) => item.category));

  const ordered = composition.categoryOrder.filter((category) =>
    present.has(category),
  );

  // Editörün atladığı kategoriler yine de bültende yer alsın.
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
