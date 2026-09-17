
const TR_STOPWORDS = new Set([
  "ve", "ile", "bir", "bu", "için", "olarak", "daha", "gibi", "ama", "olan",
  "kadar", "sonra", "önce", "göre", "üzerine", "her", "çok", "en", "de", "da",
  "ne", "ki", "mi", "var", "yok", "oldu", "olduğu", "yeni", "büyük", "son",
  "ilk", "arasında", "karşı", "hem", "ise", "ancak", "tüm", "bazı", "kendi",
]);

const EN_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "its", "are",
  "was", "will", "how", "why", "what", "new", "now", "out", "has", "have",
  "into", "you", "but", "not", "can", "all", "our", "their", "been", "were",
  "more", "than", "after", "over", "about", "when", "which", "they", "would",
]);

const TR_LETTERS = /[ıİğĞşŞçÇöÖüÜ]/g;

const TR_SUFFIXES =
  /\b\w+(ler|lar|dir|dır|nin|nın|den|dan|ile|için|lik|lık|siz|sız)\b/gi;

const MIN_CHARS = 120;

export type LanguageGuess = { language: string; confidence: number };

export function detectLanguage(text: string): LanguageGuess {
  const clean = text.replace(/\s+/g, " ").trim();

  if (clean.length < MIN_CHARS) {
    return { language: "unknown", confidence: 0 };
  }

  const words = clean.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

  if (words.length < 20) {
    return { language: "unknown", confidence: 0 };
  }

  let tr = 0;
  let en = 0;

  for (const word of words) {
    if (TR_STOPWORDS.has(word)) {
      tr += 1;
    }
    if (EN_STOPWORDS.has(word)) {
      en += 1;
    }
  }

  tr += (clean.match(TR_LETTERS)?.length ?? 0) / 8;
  tr += (clean.match(TR_SUFFIXES)?.length ?? 0) / 2;

  const total = tr + en;

  if (total < 3) {
    return { language: "unknown", confidence: 0 };
  }

  const [language, top, other] = tr >= en ? ["tr", tr, en] : ["en", en, tr];
  const confidence = Number(((top - other) / total).toFixed(2));

  if (confidence < 0.2) {
    return { language: "unknown", confidence };
  }

  return { language: language as string, confidence };
}
