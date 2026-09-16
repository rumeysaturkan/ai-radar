/**
 * Tohumlanabilir karıştırma. Puanlama 30'luk gruplara bölünüp her grup
 * birbirinden bağımsız puanlandığı için gruplar arası kalibrasyon kayması
 * oluyor; adaylar besleme sırasında geldiğinde bu kayma doğrudan kaynak
 * sırasıyla hizalanıyor. Karıştırma bu hizalanmayı bozar.
 *
 * Tohum sayının kimliği olduğu için sonuç aynı hafta içinde tekrar
 * çalıştırıldığında değişmez — hat deterministik kalır.
 */

function hashSeed(text: string): number {
  // FNV-1a; kriptografik değil, sadece dağılımı düzgün bir başlangıç değeri.
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(hashSeed(seed));
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }

  return result;
}
