/** Keşif akışının paylaşılan tipleri. */

export type DiscoveryRequest = {
  /** Kullanıcının yazdığı haliyle konu. */
  topic: string;
  /** Tercih edilen kaynak dili; filtre değil, sıralama sinyali. */
  language: string;
  windowDays: number;
  maxFeeds: number;
  strictLanguage: boolean;
};

export type CandidateSite = {
  name: string;
  /** Bulunduğu haliyle adres; bir yazı adresi de olabilir. */
  url: string;
  /** Normalize edilmiş https://host — yoklamanın kökü. */
  origin: string;
  /** İnsana gösterilecek tek satırlık gerekçe. */
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
  /** Preset'teki feed.max için önerilen kota. */
  suggestedMax: number;
  /** Feed kendi dilini bildiriyorsa o; sezgisel tahminden güvenilir. */
  declaredLanguage: string | null;
  detectedLanguage: string | null;
  languageConfidence: number;
  feedTitle: string | null;
  /** En fazla 8; hem sıralama hem profil adımına gider. */
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
  /** Nezaket ve maliyet muhasebesi: bu site için kaç istek atıldı. */
  requestCount: number;
};

export type RankedFeed = FeedFinding & {
  credibility: number;
  verdict: "keep" | "maybe" | "drop";
  reason: string;
  suggestedName: string;
};

/**
 * analyzeFeed'in rss-parser'ı içe aktarmaması için yapısal tip: testler düz
 * nesne verebilsin. Parser.Output bu şekle yapısal olarak uyuyor.
 */
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
