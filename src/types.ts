export type Candidate = {
  /** Kanonik URL'den türetilen kararlı kimlik. */
  id: string;
  title: string;
  url: string;
  source: string;
  /** ISO 8601, kaynak tarih vermediyse null. */
  publishedAt: string | null;
  snippet: string;
  /** Hacker News puanı; diğer kaynaklarda null. */
  points: number | null;
};

export type ScoredCandidate = Candidate & {
  /** 0-10. */
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

/** Bir kaynağın o sayıdaki hunisi: kaç aday verdi, kaçı bültene girdi. */
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
  /**
   * Adım bazlı döküm. Projenin merkezi iddiası "ucuz model yüzlerce adaya,
   * pahalı model son on ikiye"; tek bir toplam bunu göstermiyordu.
   * Eski sayılarda bulunmaz.
   */
  stages?: StageUsage[];
};

export type Issue = {
  /** ISO hafta kimliği, ör. "2026-W38". */
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
  /**
   * Puanlanan adayların tamamı, elenenler dahil. Yalnızca yayınlananları
   * saklamak "X neden girmedi?" sorusunu cevaplanamaz, puanlayıcıyı
   * ölçülemez ve kaynak verimliliğini hesaplanamaz yapıyordu.
   * Eski sayılarda bulunmaz.
   */
  candidates?: ScoredCandidate[];
  /** Kaynak başına huni. Eski sayılarda bulunmaz. */
  sources?: SourceStat[];
};
