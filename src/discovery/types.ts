
export type DiscoveryRequest = {
  topic: string;
  language: string;
  windowDays: number;
  maxFeeds: number;
  strictLanguage: boolean;
};

export type CandidateSite = {
  name: string;
  url: string;
  origin: string;
  why: string;
  via: "llm" | "search";
};

export type FeedLink = {
  url: string;
  title: string | null;
  via: "link-tag" | "probe";
};

export type FeedHealth = {
  itemCount: number;
  lastPublishedAt: string | null;
  daysSinceLastPost: number | null;
  itemsPerWeek: number;
  suggestedMax: number;
  declaredLanguage: string | null;
  detectedLanguage: string | null;
  languageConfidence: number;
  feedTitle: string | null;
  sampleTitles: string[];
};

export type FeedStatus =
  | "ok"
  | "stale"
  | "empty"
  | "unparsable"
  | "no-feed"
  | "unreachable";

export type FeedFinding = {
  site: CandidateSite;
  feed: FeedLink | null;
  health: FeedHealth | null;
  status: FeedStatus;
  error: string | null;
  requestCount: number;
};

export type RankedFeed = FeedFinding & {
  credibility: number;
  verdict: "keep" | "maybe" | "drop";
  reason: string;
  suggestedName: string;
};

export type ParsedFeed = {
  title?: string | undefined;
  link?: string | undefined;
  language?: string | undefined;
  items: readonly {
    title?: string | undefined;
    isoDate?: string | undefined;
    pubDate?: string | undefined;
    contentSnippet?: string | undefined;
  }[];
};
