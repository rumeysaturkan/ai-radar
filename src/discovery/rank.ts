import { structured } from "../llm.js";
import { domainOf } from "../util/url.js";
import type { DiscoveryRequest, FeedFinding, RankedFeed } from "./types.js";

export type Rating = {
  index: number;
  credibility: number;
  verdict: string;
  reason: string;
  suggestedName: string;
};

const VERDICTS = new Set(["keep", "maybe", "drop"]);

const schema = {
  type: "object",
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          credibility: { type: "integer" },
          verdict: { type: "string", enum: ["keep", "maybe", "drop"] },
          reason: { type: "string" },
          suggestedName: { type: "string" },
        },
        required: ["index", "credibility", "verdict", "reason", "suggestedName"],
        additionalProperties: false,
      },
    },
  },
  required: ["ratings"],
  additionalProperties: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Modelin cevabını kullanılabilir hale getirir. Saf, çünkü hataların yaşadığı
 * yer burası: aralık dışı index, uydurulmuş verdict, boş isim.
 */
export function applyRatings(
  findings: readonly FeedFinding[],
  ratings: readonly Rating[],
): RankedFeed[] {
  const ranked: RankedFeed[] = [];

  for (const rating of ratings) {
    const finding = findings[rating.index];

    if (!finding) {
      // score.ts'te olduğu gibi: aralık dışı index sessizce atlanır.
      continue;
    }

    const suggested =
      rating.suggestedName.trim() ||
      finding.health?.feedTitle ||
      finding.site.name ||
      domainOf(finding.site.origin);

    ranked.push({
      ...finding,
      credibility: clamp(rating.credibility, 0, 10),
      verdict: VERDICTS.has(rating.verdict)
        ? (rating.verdict as RankedFeed["verdict"])
        : "maybe",
      reason: rating.reason.trim(),
      suggestedName: suggested.slice(0, 60),
    });
  }

  return ranked;
}

const VERDICT_ORDER: Record<RankedFeed["verdict"], number> = {
  keep: 0,
  maybe: 1,
  drop: 2,
};

/**
 * Dil bir sıralama sinyali, filtre değil. ("quantum computing", tr) için doğru
 * cevap "iyi kaynakların neredeyse hepsi İngilizce" — sert bir filtre boş bir
 * preset üretirdi.
 */
function languageBonus(feed: RankedFeed, wanted: string): number {
  const declared = feed.health?.declaredLanguage;
  const detected = feed.health?.detectedLanguage;
  const language = declared ?? detected;

  if (!language) {
    return 0;
  }

  return language === wanted ? 1 : 0;
}

export function sortFeeds(
  feeds: readonly RankedFeed[],
  request: DiscoveryRequest,
): RankedFeed[] {
  return [...feeds].sort((a, b) => {
    const byVerdict = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];

    if (byVerdict !== 0) {
      return byVerdict;
    }

    const byLanguage =
      languageBonus(b, request.language) - languageBonus(a, request.language);

    if (byLanguage !== 0) {
      return byLanguage;
    }

    if (a.credibility !== b.credibility) {
      return b.credibility - a.credibility;
    }

    // Bayat kaynak elenmez, sadece arkaya düşer.
    const freshA = a.health?.daysSinceLastPost ?? Number.MAX_SAFE_INTEGER;
    const freshB = b.health?.daysSinceLastPost ?? Number.MAX_SAFE_INTEGER;

    return freshA - freshB;
  });
}

/**
 * Tek bir toplu çağrıyla güvenilirlik değerlendirmesi. Alan adı tek başına
 * tahmin yürütmek demek; asıl ayırt edici sinyal örnek başlıklar — bir meslek
 * yayınını SEO çiftliğinden ayıran şey o.
 */
export async function rankFeeds(
  findings: readonly FeedFinding[],
  request: DiscoveryRequest,
  model: string,
): Promise<RankedFeed[]> {
  if (findings.length === 0) {
    return [];
  }

  const payload = findings.map((finding, index) => ({
    index,
    domain: domainOf(finding.site.origin),
    feedTitle: finding.health?.feedTitle ?? null,
    itemsPerWeek: finding.health?.itemsPerWeek ?? 0,
    daysSinceLastPost: finding.health?.daysSinceLastPost ?? null,
    language: finding.health?.declaredLanguage ?? finding.health?.detectedLanguage ?? null,
    sampleTitles: finding.health?.sampleTitles ?? [],
  }));

  const response = await structured<{ ratings: Rating[] }>({
    model,
    system: [
      `You are assembling the source list for a briefing about: ${request.topic}.`,
      "",
      "For each candidate feed, judge whether it is a credible, useful source",
      "for this topic. You are given its domain, how often it posts and a",
      "sample of its recent headlines. Judge mostly on the headlines.",
      "",
      "- credibility 0-10: does this publish substantive reporting or analysis",
      "  on the topic? A trade publication or a practitioner's blog scores",
      "  high. An SEO content farm, an affiliate roundup site, a press-release",
      "  mirror or a general aggregator scores low.",
      "- verdict: keep only if MOST of the sample headlines are about this",
      "  topic. A credible publication that mostly covers something else is a",
      "  drop, not a keep -- a general business or news channel will otherwise",
      "  flood the briefing with material its readers did not ask for. Use",
      "  maybe when the topic is a recurring but minor part of its coverage.",
      "- reason: one short sentence, in English.",
      "- suggestedName: a short display name for the source, as a reader would",
      "  recognise it. No URLs.",
      "",
      "A feed that posts very often is not automatically better; a weekly",
      "publication with real analysis beats a daily press-release mirror.",
    ].join("\n"),
    user: `Candidate feeds:\n${JSON.stringify(payload, null, 1)}`,
    schemaName: "feed_ratings",
    schema,
    stage: "discovery",
    reasoningEffort: "low",
  });

  return sortFeeds(applyRatings(findings, response.ratings), request);
}
