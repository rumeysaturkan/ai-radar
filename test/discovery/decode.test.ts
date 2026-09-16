import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeBody, sniffCharset } from "../../src/discovery/decode.js";

function bytes(text: string, encoding: "utf-8" | "windows-1254" = "utf-8"): ArrayBuffer {
  if (encoding === "utf-8") {
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
  }

  // windows-1254 is Latin-5: identical to latin1 apart from the Turkish
  // letters, which is enough to build a fixture by hand.
  const map: Record<string, number> = {
    ı: 0xfd, İ: 0xdd, ğ: 0xf0, Ğ: 0xd0, ş: 0xfe, Ş: 0xde,
    ç: 0xe7, Ç: 0xc7, ö: 0xf6, Ö: 0xd6, ü: 0xfc, Ü: 0xdc,
  };

  const out = new Uint8Array(text.length);

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    out[i] = map[ch] ?? ch.charCodeAt(0);
  }

  return out.buffer;
}

describe("sniffCharset", () => {
  it("prefers the charset in the content-type header", () => {
    assert.equal(
      sniffCharset(bytes("<html>"), "text/html; charset=ISO-8859-9"),
      "iso-8859-9",
    );
  });

  it("falls back to the XML declaration", () => {
    assert.equal(
      sniffCharset(bytes('<?xml version="1.0" encoding="windows-1254"?><rss>'), "text/xml"),
      "windows-1254",
    );
  });

  it("falls back to a meta charset tag", () => {
    assert.equal(
      sniffCharset(bytes('<html><head><meta charset="windows-1254">'), "text/html"),
      "windows-1254",
    );
  });

  it("reads the older http-equiv form", () => {
    assert.equal(
      sniffCharset(
        bytes('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-9">'),
        "text/html",
      ),
      "iso-8859-9",
    );
  });

  it("assumes utf-8 when nothing says otherwise", () => {
    assert.equal(sniffCharset(bytes("<html>"), "text/html"), "utf-8");
  });
});

describe("decodeBody", () => {
  it("decodes a legacy Turkish encoding correctly", () => {
    // response.text() would assume UTF-8 here and produce mojibake, which
    // then poisons both language detection and the titles sent to the model.
    const raw = bytes("Guvenlik zafiyeti: ş ğ ı ç ö ü", "windows-1254");

    assert.equal(
      decodeBody(raw, "text/html; charset=windows-1254"),
      "Guvenlik zafiyeti: ş ğ ı ç ö ü",
    );
  });

  it("round-trips plain UTF-8", () => {
    assert.equal(
      decodeBody(bytes("Yapay zekâ — ölçüm"), "text/html; charset=utf-8"),
      "Yapay zekâ — ölçüm",
    );
  });

  it("falls back to utf-8 rather than throwing on an unknown label", () => {
    assert.equal(decodeBody(bytes("hello"), "text/html; charset=nonsense-9"), "hello");
  });

  it("handles an empty body", () => {
    assert.equal(decodeBody(new ArrayBuffer(0), "text/html"), "");
  });
});
