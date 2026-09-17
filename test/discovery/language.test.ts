import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectLanguage } from "../../src/discovery/language.js";

const TURKISH = `
Yapay zeka alanında bu hafta öne çıkan gelişmeler arasında yeni model
sürümleri ve geliştirici araçları yer alıyor. Şirketin açıkladığı yeni
sürüm, önceki nesle göre daha hızlı çalışıyor ve daha az kaynak tüketiyor.
Araştırmacılar bu yaklaşımın uzun vadede maliyetleri düşüreceğini belirtiyor.
Kullanıcılar için en önemli değişiklik ise arayüzde yapılan sadeleştirme.
`;

const ENGLISH = `
The company announced a new release this week that runs faster than the
previous generation and uses fewer resources. Researchers say the approach
will bring costs down over the long run, and the most visible change for
users is a simplified interface. The tooling around it has also been updated
and the old interface has been removed from the documentation entirely.
`;

const TURKISH_NO_DIACRITICS = `
Guvenlik acigi tespit edildi ve yamalar yayinlandi. Sirketin acikladigi yeni
surum, onceki nesle gore daha hizli calisiyor ve daha az kaynak tuketiyor.
Arastirmacilar bu yaklasimin uzun vadede maliyetleri dusurecegini belirtiyor.
Kullanicilar icin en onemli degisiklik ise arayuzde yapilan sadelestirme oldu.
`;

describe("detectLanguage", () => {
  it("recognises Turkish", () => {
    const guess = detectLanguage(TURKISH);

    assert.equal(guess.language, "tr");
    assert.ok(guess.confidence > 0.3, `confidence was ${guess.confidence}`);
  });

  it("recognises English", () => {
    const guess = detectLanguage(ENGLISH);

    assert.equal(guess.language, "en");
    assert.ok(guess.confidence > 0.3, `confidence was ${guess.confidence}`);
  });

  it("still recognises Turkish written without diacritics", () => {
    assert.equal(detectLanguage(TURKISH_NO_DIACRITICS).language, "tr");
  });

  it("declines to guess from a handful of words", () => {
    assert.equal(detectLanguage("OpenAI GPT-5").language, "unknown");
    assert.equal(detectLanguage("").language, "unknown");
    assert.equal(detectLanguage("Kısa bir başlık").language, "unknown");
  });

  it("declines when the two languages score close together", () => {
    const mixed = `${TURKISH.slice(0, 300)} ${ENGLISH.slice(0, 300)}`;
    const guess = detectLanguage(mixed);

    assert.ok(
      guess.language === "unknown" || guess.confidence < 0.6,
      "mixed text should not produce a confident answer",
    );
  });

  it("reports confidence between 0 and 1", () => {
    for (const text of [TURKISH, ENGLISH, TURKISH_NO_DIACRITICS, "short"]) {
      const { confidence } = detectLanguage(text);
      assert.ok(confidence >= 0 && confidence <= 1, `got ${confidence}`);
    }
  });
});
