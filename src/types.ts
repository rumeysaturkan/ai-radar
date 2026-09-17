export type Candidate = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  points: number | null;
};

export type ScoredCandidate = Candidate & {
  score: number;
  reason: string;
  category: string;
};

export type Item = ScoredCandidate & {
  tldr: string;
  whyItMatters: string;
  tags: string[];
};

export type IssueStats = {
  collected: number;
  fresh: number;
  scored: number;
  published: number;
};

export type SourceStat = {
  name: string;
  scanned: number;
  scored: number;
  published: number;
};

export type StageUsage = {
  stage: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  priced: boolean;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  stages?: StageUsage[];
};

export type Issue = {
  id: string;
  number: number;
  title: string;
  tagline: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  intro: string;
  highlightId: string;
  items: Item[];
  stats: IssueStats;
  usage: Usage;
  candidates?: ScoredCandidate[];
  sources?: SourceStat[];
};
