import type { ScoredCandidate } from "../types.js";
import { registrableDomain } from "../util/url.js";

/** Bülteni boş bırakmamak için puan eşiği gerektiğinde gevşetilir. */
export const MIN_ITEMS = 5;

export type SelectOptions = {
  minScore: number;
  shortlist: number;
  /** Aynı yayıncıdan en fazla kaç haber; verilmezse listeden türetilir. */
  maxPerDomain?: number;
  now?: Date;
};

const DAY_MS = 86_400_000;

/**
 * Kaç gün önce yayınlandı. Ham zaman damgası yerine gün kovası kullanılıyor:
 * arXiv gibi kaynaklar günlük yığını aynı 00:00:00Z damgasıyla bırakıyor ve
 * saniye hassasiyeti tek bir kaynağın bütün bir puan seviyesini süpürmesine
 * yol açıyor.
 */
function ageInDays(candidate: ScoredCandidate, now: number): number {
  if (!candidate.publishedAt) {
    // Tarihi bilinmeyen içerik eşitlikte kaybeder; hakkında daha az şey biliyoruz.
    return Number.MAX_SAFE_INTEGER;
  }

  const published = new Date(candidate.publishedAt).getTime();

  if (Number.isNaN(published)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(0, Math.floor((now - published) / DAY_MS));
}

/**
 * Sıralama anahtarı. Son basamak kasıtlı olarak içerik kimliği: kimlik
 * kanonik URL'nin sha1'i olduğu için dağılımı düzgün ve preset'teki besleme
 * sırasıyla ilintisiz. Önceden eşitlikler kararlı sıralama yüzünden her zaman
 * dosyadaki ilk beslemeye gidiyordu.
 */
function compare(a: ScoredCandidate, b: ScoredCandidate, now: number): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  const ageA = ageInDays(a, now);
  const ageB = ageInDays(b, now);

  if (ageA !== ageB) {
    return ageA - ageB;
  }

  const pointsA = a.points ?? 0;
  const pointsB = b.points ?? 0;

  if (pointsA !== pointsB) {
    return pointsB - pointsA;
  }

  return a.id.localeCompare(b.id);
}

export function rank(
  scored: readonly ScoredCandidate[],
  now: Date = new Date(),
): ScoredCandidate[] {
  const timestamp = now.getTime();
  return [...scored].sort((a, b) => compare(a, b, timestamp));
}

/**
 * Bültene girecek içerikleri seçer.
 *
 * İki aşama: önce sıralama, sonra yayıncı çeşitliliği. Çeşitlilik geçişi
 * olmadan tek bir kurumsal blogun haftanın yarısını doldurması mümkün —
 * puanlayıcı 97 adayın onlarcasına aynı puanı verdiği için sıralama tek
 * başına ayırt etmiyor.
 */
export function select(
  scored: readonly ScoredCandidate[],
  options: SelectOptions,
): ScoredCandidate[] {
  const ranked = rank(scored, options.now ?? new Date());
  const strong = ranked.filter((item) => item.score >= options.minScore);

  // Eşiği geçen çok az içerik varsa bülteni boş bırakmak yerine eşik
  // gevşetilir, ama sayı da kısa tutulur.
  const enough = strong.length >= MIN_ITEMS;
  const pool = enough ? strong : ranked;
  const limit = enough
    ? options.shortlist
    : Math.min(options.shortlist, MIN_ITEMS);

  const cap =
    options.maxPerDomain ?? Math.max(2, Math.ceil(options.shortlist / 4));

  const picked: ScoredCandidate[] = [];
  const perDomain = new Map<string, number>();
  const remaining = [...pool];

  // Havuzda yeterli çeşitlilik yoksa sınırı büsbütün bırakmak yerine bir
  // kademe yükseltip tekrar dolaşılır. Düz bir geri doldurma, artan yerlerin
  // tamamını en üstteki yayıncıya verip sınırı anlamsızlaştırıyordu; kademeli
  // yükseltme fazlalığı baskın kaynaklar arasında paylaştırır.
  for (let currentCap = cap; picked.length < limit; currentCap += 1) {
    let progressed = false;
    let index = 0;

    while (index < remaining.length && picked.length < limit) {
      const candidate = remaining[index]!;
      const domain = registrableDomain(candidate.url);
      const used = perDomain.get(domain) ?? 0;

      if (used < currentCap) {
        picked.push(candidate);
        perDomain.set(domain, used + 1);
        remaining.splice(index, 1);
        progressed = true;
      } else {
        index += 1;
      }
    }

    // Havuz tükendi; listeyi doldurmak mümkün değil.
    if (!progressed) {
      break;
    }
  }

  return rank(picked, options.now ?? new Date());
}
