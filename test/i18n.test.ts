import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { languageName, outputLanguageRule, resolveLang, t } from "../src/i18n.js";

describe("resolveLang", () => {
  it("accepts the supported languages", () => {
    assert.equal(resolveLang("tr"), "tr");
    assert.equal(resolveLang("en"), "en");
  });

  it("takes the base of a regional tag", () => {
    assert.equal(resolveLang("tr-TR"), "tr");
    assert.equal(resolveLang("en_US"), "en");
    assert.equal(resolveLang("EN-GB"), "en");
  });

  it("falls back to English rather than throwing", () => {
    assert.equal(resolveLang("de"), "en");
    assert.equal(resolveLang(""), "en");
    assert.equal(resolveLang(undefined), "en");
  });
});

describe("languageName", () => {
  it("names a language from its tag", () => {
    // Comes from Node's own data, so there is no table to keep in sync.
    assert.equal(languageName("tr"), "Turkish");
    assert.equal(languageName("en"), "English");
    assert.equal(languageName("de"), "German");
  });

  it("returns the tag unchanged when it means nothing", () => {
    assert.equal(languageName("zzzz"), "zzzz");
  });
});

describe("outputLanguageRule", () => {
  it("names the target language in the instruction", () => {
    assert.match(outputLanguageRule("tr"), /in Turkish/);
    assert.match(outputLanguageRule("en"), /in English/);
  });

  it("works for a language with no UI strings", () => {
    // Prompt bodies are English and only the output language varies, so a
    // preset can target a language the interface does not speak.
    assert.match(outputLanguageRule("ja"), /in Japanese/);
  });

  it("protects names and versions from translation", () => {
    assert.match(outputLanguageRule("tr"), /proper nouns/);
  });
});

describe("t", () => {
  it("returns the string for the requested language", () => {
    assert.equal(t("tr", "html.whyItMatters"), "Neden önemli:");
    assert.equal(t("en", "html.whyItMatters"), "Why it matters:");
  });

  it("substitutes variables", () => {
    const text = t("en", "md.footer", {
      collected: 939,
      published: 12,
      title: "AI Radar",
    });

    assert.match(text, /939 candidates/);
    assert.match(text, /12 stories/);
    assert.match(text, /AI Radar/);
  });

  it("substitutes every occurrence of a variable", () => {
    assert.ok(!t("tr", "md.footer", { collected: 1, published: 2, title: "X" }).includes("{"));
  });

  it("falls back to English for an unsupported language", () => {
    assert.equal(t("de", "html.archive"), t("en", "html.archive"));
  });

  it("has no untranslated placeholders left in any string", () => {
    // Record<Lang, Record<Key, string>> catches a missing key at compile time;
    // this catches a variable someone forgot to pass.
    for (const lang of ["tr", "en"] as const) {
      const rendered = t(lang, "html.compiledBy", { title: "X", date: "Y" });
      assert.ok(!rendered.includes("{"), `${lang} left a placeholder`);
    }
  });
});
