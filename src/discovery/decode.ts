/**
 * response.text() başlıkta charset yoksa UTF-8 varsayıyor. Eski yığınlarda
 * duran Türkçe siteler hâlâ windows-1254 / ISO-8859-9 sunuyor ve sonuç
 * "zafiyet" yerine "zafÄ±yet" oluyor. Bu mojibake hem dil tespitini hem de
 * modele giden örnek başlıkları zehirliyor, o yüzden bayt seviyesinde
 * çözülüyor.
 *
 * TextDecoder tüm WHATWG etiketlerini destekliyor; ek bağımlılık gerekmiyor.
 */

const CHARSET_IN_CONTENT_TYPE = /charset\s*=\s*["']?([\w-]+)/i;
const CHARSET_IN_XML_DECL = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i;
const CHARSET_IN_META = /<meta[^>]*charset\s*=\s*["']?([\w-]+)/i;
const CHARSET_IN_META_HTTP_EQUIV =
  /<meta[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i;

/** Gövdenin ilk kilobaytı, etiket aramak için latin1 olarak okunur. */
function peek(bytes: ArrayBuffer): string {
  return new TextDecoder("latin1").decode(new Uint8Array(bytes).slice(0, 2048));
}

export function sniffCharset(bytes: ArrayBuffer, contentType: string): string {
  const fromHeader = CHARSET_IN_CONTENT_TYPE.exec(contentType)?.[1];

  if (fromHeader) {
    return fromHeader.toLowerCase();
  }

  const head = peek(bytes);

  const fromDocument =
    CHARSET_IN_XML_DECL.exec(head)?.[1] ??
    CHARSET_IN_META.exec(head)?.[1] ??
    CHARSET_IN_META_HTTP_EQUIV.exec(head)?.[1];

  return (fromDocument ?? "utf-8").toLowerCase();
}

export function decodeBody(bytes: ArrayBuffer, contentType: string): string {
  const charset = sniffCharset(bytes, contentType);

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Tanınmayan etiket; UTF-8 en makul tahmin.
    return new TextDecoder("utf-8").decode(bytes);
  }
}
