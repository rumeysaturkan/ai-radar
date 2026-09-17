import { languageName } from "../i18n.js";
import { structured } from "../llm.js";
import type { DiscoveryRequest } from "./types.js";

export type TopicBrief = {
  canonicalTopic: string;
  searchQueries: string[];
  seedDomains: string[];
};

const schema = {
  type: "object",
  properties: {
    canonicalTopic: { type: "string" },
    searchQueries: { type: "array", items: { type: "string" } },
    seedDomains: { type: "array", items: { type: "string" } },
  },
  required: ["canonicalTopic", "searchQueries", "seedDomains"],
  additionalProperties: false,
};

export async function makeTopicBrief(
  request: DiscoveryRequest,
  model: string,
): Promise<TopicBrief> {
  const language = languageName(request.language);

  const brief = await structured<TopicBrief>({
    model,
    system: [
      "You help assemble the source list for a weekly briefing.",
      "",
      "Given a topic, produce:",
      "- canonicalTopic: the topic stated clearly in English, for internal use.",
      "- searchQueries: 8 web searches that would surface publications, trade",
      "  press and serious blogs covering this topic. Search for SOURCES, not",
      "  for individual news stories. Roughly half the queries should be in",
      `  ${language} and half in English.`,
      "- seedDomains: up to 12 bare domain names you are confident publish on",
      "  this topic regularly. Domains only, no paths, no protocol. Include",
      `  ${language}-language publications where they exist, plus the most`,
      "  important international ones. If you are not confident a domain",
      "  exists, leave it out.",
      "",
      "Prefer publications that post regularly over one-off resources. Avoid",
      "social networks, video platforms, wikis, marketplaces and aggregators.",
    ].join("\n"),
    user: `Topic: ${request.topic}\nPreferred source language: ${language}`,
    schemaName: "topic_brief",
    schema,
    stage: "discovery",
    reasoningEffort: "low",
  });

  return {
    canonicalTopic: brief.canonicalTopic.trim() || request.topic,
    searchQueries: brief.searchQueries
      .map((query) => query.trim())
      .filter(Boolean)
      .slice(0, 10),
    seedDomains: brief.seedDomains
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12),
  };
}
