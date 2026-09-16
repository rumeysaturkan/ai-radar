# AI Radar

Tek komutla **haftalık bülten** üreten açık kaynak araç. Bir alan seçersiniz;
onlarca kaynağı tarar, tekrarları eler, kalanları puanlar ve elinizde yayına
hazır bir HTML sayfası bırakır.

```bash
npm install
npm start
```

İlk çalıştırmada hangi alanda bülten istediğinizi sorar, API anahtarınızı alıp
`.env` dosyasına kaydeder ve bülteni üretip tarayıcınızda açar. Başka kurulum
adımı yok.

## Alanlar

Kutudan çıkan dört alan var, her biri kendi kaynak listesi, konuları ve
kategorileriyle gelir:

| Kimlik           | Alan                | Kaynak | Örnek besleme                     |
| ---------------- | ------------------- | ------ | --------------------------------- |
| `ai`             | Yapay Zeka          | 13     | OpenAI, DeepMind, arXiv, HF       |
| `siber-guvenlik` | Siber Güvenlik      | 10     | Krebs, Project Zero, CISA         |
| `yazilim`        | Yazılım Geliştirme  | 14     | GitHub, Go, Rust, V8, InfoQ       |
| `veri-altyapi`   | Veri & Altyapı      | 15     | AWS, Kubernetes, PostgreSQL       |

Alanı seçmenin iki yolu var:

```bash
npm start              # listeden seç (son seçim hatırlanır)
npm start siber-guvenlik   # doğrudan üret
```

Her alan **kendi hafızasını ve arşivini** tutar — birinde yayınlanan haber
diğerini etkilemez.

## Ne üretiyor?

`npm start yazilim` çalıştırdığınızda:

| Dosya                       | İçerik                                            |
| --------------------------- | ------------------------------------------------- |
| `dist/yazilim/2026-W38.html` | Bültenin kendisi — tek dosya, karanlık mod destekli |
| `dist/yazilim/2026-W38.md`   | LinkedIn/Slack/Medium'a yapıştırılabilir Markdown  |
| `dist/yazilim/index.html`    | O alanın tüm sayılarının arşivi                    |
| `dist/yazilim/feed.xml`      | Abone olunabilir RSS akışı                         |
| `dist/index.html`            | Kapak: üretilmiş tüm alanların listesi             |

## Nasıl çalışıyor?

Serbest bir "ajan döngüsü" yerine **altı adımlı bir hat** var. Her adımda modele
tek bir dar iş veriliyor; bu yüzden çıktı her hafta aynı şekilde geliyor ve
maliyet öngörülebilir kalıyor.

```
1. TOPLA          RSS + Hacker News + web araması        → ~1000 aday
      │           (kaynak başına kota: tek bir besleme
      │            havuzu dolduramaz)
      ▼
2. TEKİLLEŞTİR    Kanonik URL + başlık benzerliği         → kopyalar gider
      │           data/<alan>/seen.json ile geçmiş sayılar → tekrar gitmez
      ▼
3. PUANLA         Ucuz model, 30'luk gruplar, 0-10 puan   → ~160 içerik
      │           JSON şemasıyla zorunlu format
      ▼
4. ZENGİNLEŞTİR   Sadece seçilenlerin sayfası indirilir   → 12 haber
      │           Her biri için: tldr, neden önemli, etiket
      ▼
5. DERLE          Editör geçişi: giriş yazısı, haftanın
      │           öne çıkanı, kategori sıralaması
      ▼
6. YAYINLA        HTML + Markdown + arşiv + RSS + kapak
```

Pahalı iş (tam sayfa indirme, güçlü model) yalnızca son 12 habere uygulanıyor;
eleme işini ucuz model ve düz kod yapıyor. Bülten başına maliyet birkaç senttir
ve her sayının altında gerçek rakam yazar.

Hattın kendisi konuyu bilmez — hangi alanda çalıştığı tamamen preset
dosyasından gelir. "Yapay zeka" kelimesi hiçbir prompt'a gömülü değildir.

### Hafıza neden önemli?

`data/<alan>/seen.json` yalnızca **yayınlanmış** haberleri tutar. Sonuç:

- Aynı haber iki hafta üst üste bültene giremez.
- Bu hafta elenen bir haber, gelecek hafta olgunlaşırsa tekrar değerlendirilir.
- Editör adımına geçen sayının başlıkları verilir, böylece "geçen hafta
  duyurulan X bu hafta yayınlandı" gibi devamlılık kurabilir.

## Kendi alanını kurmak

`presets/` altına bir JSON dosyası ekleyin — dosya adı alanın kimliği olur.
Kod değişikliği gerekmez:

```jsonc
// presets/oyun.json  →  npm start oyun
{
  "id": "oyun",                    // dosya adıyla aynı olmalı
  "name": "Oyun Sektörü",          // seçim ekranında görünen ad
  "title": "Oyun Radar",           // bülten başlığı
  "tagline": "Haftalık oyun bülteni",
  "audience": "Oyun geliştiriciler ve sektör takipçileri",
  "topics": ["motor sürümleri", "stüdyo haberleri", "..."],  // puanlama bunlara göre
  "categories": ["Motor & Araçlar", "Çıkışlar", "Sektör"],   // bülten bölümleri
  "shortlist": 12,        // bültene kaç haber girsin
  "minScore": 6,          // altındakiler elenir
  "maxPerSource": 12,     // tek kaynağın havuzu doldurmasını engeller
  "models": { "scorer": "gpt-4o-mini", "writer": "gpt-4o" },
  "feeds": [{ "name": "Game Developer", "url": "https://..." }],
  "hackerNews": { "enabled": false, "minPoints": 100, "queries": [] },
  "webSearch": { "enabled": true, "queries": ["game industry news this week"] }
}
```

Dikkat edilecek üç şey:

- **`feeds` içindeki bir kaynağa `"max": 8`** verirseniz o besleme için ayrı
  kota uygulanır (arXiv veya CISA gibi günde yüzlerce kayıt üreten kaynaklarda
  gerekli).
- **Hacker News teknoloji dışı alanlarda işe yaramaz** — `enabled: false` yapın,
  web araması ana kaynak olsun.
- **`topics` dar ve net olsun.** "Her şey" yazarsanız puanlama adımı neyi
  eleyeceğini bilemez; motor dar konuda iyi çalışır.

## Anahtarlar

| Değişken         | Zorunlu mu? | Nereden                              |
| ---------------- | ----------- | ------------------------------------ |
| `OPENAI_API_KEY` | Evet        | https://platform.openai.com/api-keys |
| `TAVILY_API_KEY` | Hayır       | https://app.tavily.com/              |

Tavily anahtarı yoksa web araması atlanır, bülten yalnızca RSS ve Hacker News
ile üretilir. Anahtarlar `.env` dosyasında tutulur ve `.gitignore` ile depodan
uzak tutulur.

## Bonus: araştırma ajanı

Bülten hattı deterministik; ama tek bir konuyu derinlemesine araştırmak için
proje içinde bir **tool-calling ajanı** da var. Model hangi aracı ne zaman
çağıracağına kendisi karar verir:

```bash
npm run research -- "AI agent memory"
```

Araçları: `searchWeb`, `readSource`, `readKnowledge`, `updateKnowledge`.
Öğrendiklerini `knowledge/` altındaki Markdown dosyalarına yazar.

Ajan döngüsü keşif için iyidir, üretim hattı için değil: her çalıştırmada farklı
sayıda adım atar, maliyeti tahmin edilemez ve çıktısının şekli garanti değildir.
Bu yüzden bülten hattında kullanılmıyor.

## Proje yapısı

```
src/
  bulletin.ts              # Ana komut: hattı sırayla çalıştırır
  preset.ts                # Alan seçimi (argüman → liste → son seçim)
  setup.ts                 # İlk çalıştırmada anahtar sorar
  config.ts                # Preset yükleyici ve listeleyici
  llm.ts                   # Şema zorunlu LLM çağrıları + maliyet takibi
  store.ts                 # Alan başına seen.json ve arşiv
  pipeline/
    collect.ts             # RSS, Hacker News, web araması
    dedupe.ts              # Tekilleştirme + kaynak dengeleme
    score.ts               # Toplu puanlama
    enrich.ts              # Sayfa okuma + özet yazımı
    compose.ts             # Editör geçişi
    render.ts              # HTML, Markdown, arşiv, RSS, kapak
  agent/research-agent.ts  # Bonus: tool-calling ajanı
  tools/                   # Arama, sayfa okuma, bilgi tabanı araçları
presets/                   # Alan tanımları — tüm ayarlar burada
data/<alan>/               # seen.json + arşivlenmiş sayılar
dist/<alan>/               # Üretilen sayfalar
```

## Bilinen sınırlar

- `readSource` sayfaları basit regex ile metne indirger; JavaScript ile
  render edilen sitelerde içerik eksik gelebilir, o durumda arama özetiyle
  devam edilir.
- Yanıt vermeyen bir kaynak bülteni durdurmaz; uyarı basılıp atlanır.
- Puanlama rubriği (`src/pipeline/score.ts`) teknoloji/haber diline göre
  yazılmıştır. Çok farklı bir alan için (sağlık, hukuk) rubriği de preset'e
  taşımak gerekebilir.
- Maliyet tahmini `gpt-4o` ve `gpt-4o-mini` fiyatlarına göre yapılır; başka bir
  model seçerseniz `src/llm.ts` içindeki fiyat tablosuna eklemeniz gerekir.
- Etkileşimli olmayan ortamda (CI, pipe) alan sorulamaz; son kullanılan alana
  düşer. Böyle yerlerde alanı argümanla verin.

## Lisans

MIT
