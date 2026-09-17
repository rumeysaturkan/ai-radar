import { languageName, outputLanguageRule } from "../i18n.js";
import { structured } from "../llm.js";
import type { DomainProfile } from "./preset-build.js";
import type { DiscoveryRequest, RankedFeed } from "./types.js";

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    title: { type: "string" },
    tagline: { type: "string" },
    audience: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    categories: { type: "array", items: { type: "string" } },
    hackerNewsQueries: { type: "array", items: { type: "string" } },
    webSearchQueries: { type: "array", items: { type: "string" } },
  },
  required: [
    "name", "title", "tagline", "audience",
    "topics", "categories", "hackerNewsQueries", "webSearchQueries",
  ],
  additionalProperties: false,
};

const MAX_CATEGORIES = 6;
const MIN_CATEGORIES = 3;

export function truncateWords(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");

  const trimmed = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut;

  return trimmed.replace(/[\s,;:–—-]+$/, "");
}

function clean(values: readonly string[], maxLength: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = truncateWords(value, maxLength);
    const key = text.toLocaleLowerCase("tr");

    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }

  return out;
}

export function sanitizeProfile(
  raw: DomainProfile,
  request: DiscoveryRequest,
): DomainProfile {
  const categories = clean(raw.categories, 28).slice(0, MAX_CATEGORIES);

  const filler =
    request.language === "tr"
      ? ["Genel", "Öne Çıkanlar", "Diğer"]
      : ["General", "Highlights", "Other"];

  const section = (n: number): string =>
    request.language === "tr" ? `Bölüm ${n}` : `Section ${n}`;

  while (categories.length < MIN_CATEGORIES) {
    const next = filler[categories.length] ?? section(categories.length + 1);

    if (!categories.some((c) => c.toLocaleLowerCase("tr") === next.toLocaleLowerCase("tr"))) {
      categories.push(next);
    } else {
      categories.push(section(categories.length + 1));
    }
  }

  const topics = clean(raw.topics, 60).slice(0, 8);

  return {
    name: truncateWords(raw.name, 32) || truncateWords(request.topic, 32),
    title: truncateWords(raw.title, 32) || truncateWords(request.topic, 32),
    tagline: truncateWords(raw.tagline, 90) || truncateWords(request.topic, 90),
    audience: truncateWords(raw.audience, 140) || "Genel okuyucular",
    topics: topics.length > 0 ? topics : [request.topic],
    categories,
    hackerNewsQueries: clean(raw.hackerNewsQueries, 40).slice(0, 4),
    webSearchQueries: clean(raw.webSearchQueries, 80).slice(0, 3),
  };
}

export async function buildProfile(
  request: DiscoveryRequest,
  accepted: readonly RankedFeed[],
  model: string,
): Promise<DomainProfile> {
  const headlines = accepted
    .flatMap((feed) => (feed.health?.sampleTitles ?? []).slice(0, 6))
    .slice(0, 60);

  const sources = accepted.map((feed) => feed.suggestedName);

  const raw = await structured<DomainProfile>({
    model,
    system: [
      `You are setting up a weekly briefing about: ${request.topic}.`,
      "",
      "The sources have already been chosen. Using the real headlines they",
      "publish, produce:",
      "- name: a short label for this domain, for a menu.",
      "- title: the briefing's masthead, two or three words.",
      "- tagline: one short line describing it.",
      "- audience: who reads this, in one short clause naming the role. At",
      "  most 100 characters.",
      "- topics: 4-6 narrow subjects the scorer should reward, a short phrase",
      "  each, at most 50 characters. Derive them from what these sources",
      "  actually cover, not from the topic in the abstract. Narrow beats",
      "  broad: a scorer told 'everything' cannot cut.",
      `- categories: ${MIN_CATEGORIES}-${MAX_CATEGORIES} section headings that`,
      "  partition the headlines you were given. These are printed verbatim as",
      "  headings, and every story must fit exactly one. Two or three words",
      "  each, at most 24 characters, distinct, and no catch-all.",
      "- hackerNewsQueries: up to 3 Hacker News search terms, but ONLY if this",
      "  topic is software or technology. For anything else return an empty",
      "  array -- Hacker News is pure noise outside tech.",
      "- webSearchQueries: up to 3 news searches that would surface stories",
      "  this topic's feeds might miss.",
      "",
      outputLanguageRule(request.language),
    ].join("\n"),
    user: [
      `Topic: ${request.topic}`,
      `Language: ${languageName(request.language)}`,
      `Sources: ${sources.join(", ")}`,
      "",
      "Recent headlines from those sources:",
      ...headlines.map((headline) => `- ${headline}`),
    ].join("\n"),
    schemaName: "domain_profile",
    schema,
    stage: "discovery",
    reasoningEffort: "low",
  });

  return sanitizeProfile(raw, request);
}
