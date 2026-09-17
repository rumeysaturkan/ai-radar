import type { UiText } from "./i18n.js";

export const COLUMNS: Record<
  "source" | "scanned" | "scored" | "published" | "rate",
  UiText
> = {
  source: { tr: "kaynak", en: "source" },
  scanned: { tr: "taranan", en: "scanned" },
  scored: { tr: "puanlanan", en: "scored" },
  published: { tr: "yayın", en: "published" },
  rate: { tr: "oran", en: "rate" },
};
