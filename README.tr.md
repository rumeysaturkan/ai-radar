# AI Radar

**Konuyu bilmeyen bir küratörlük hattı.** Bir alan verirsiniz, haftalık bülten
alırsınız — taranmış, tekrarları elenmiş, puanlanmış ve yayına hazır bir sayfa
olarak. Sayı başına yaklaşık altı sent.

Bu depodaki hiçbir prompt'ta "yapay zeka" geçmiyor. Alan tamamen bir JSON
dosyasında yaşıyor; `presets/kahve.json` yazarsanız kod değişmeden kahve
bülteni çıkar.

*[English README](README.md)*

```bash
npm install
npm start
```

İlk çalıştırmada hangi alanda bülten istediğinizi sorar, API anahtarınızı alıp
`.env` dosyasına kaydeder, bülteni üretip tarayıcınızda açar. Başka kurulum
adımı yok.

## Kimin için

Bülten *okumak* isteyen için değil — o zaten bir bültene abone olabilir. Bu,
bülten **yayınlamak zorunda** olan kişi için: haftalık iç radar gönderen bir
mühendis, iyi bir bültenin bulunmadığı bir nişi ya da dili takip eden biri,
boş sayfa yerine düzeltilecek bir taslak isteyen bir yazar.

## Ne üretiyor

`npm start yazilim` çalıştırdığınızda:

| Dosya | İçerik |
| --- | --- |
| `dist/yazilim/2026-W38.html` | Bültenin kendisi — tek dosya, karanlık mod destekli |
| `dist/yazilim/2026-W38.md` | LinkedIn/Slack/Medium'a yapıştırılabilir Markdown |
| `dist/yazilim/index.html` | O alanın arşivi |
| `dist/yazilim/feed.xml` | RSS akışı (`siteUrl` gerekir, aşağıda) |
| `dist/index.html` | Üretilmiş tüm alanların kapağı |

## Nasıl çalışıyor

Serbest bir ajan döngüsü yok. Altı adım var ve her adımda modele tek bir dar
iş veriliyor; çıktının her hafta aynı şekilde gelmesinin ve maliyetin
öngörülebilir kalmasının sebebi bu.

```
1. TOPLA          RSS + Hacker News + web araması        → ~940 aday
2. TEKİLLEŞTİR    kanonik URL + başlık benzerliği        → kopyalar gider
   │              data/<alan>/seen.json                  → önceki sayılar çıkar
3. PUANLA         ucuz model, 30'luk gruplar, 0-10       → ~90 içerik
4. ZENGİNLEŞTİR   sadece kısa listenin sayfası indirilir → 12 haber
   │              her biri için tldr, neden önemli, etiket
5. DERLE          editör geçişi: giriş, öne çıkan, sıra
6. YAYINLA        HTML + Markdown + arşiv + RSS + kapak
```

Pahalı iş — tam sayfa indirme, güçlü model — yalnızca son on iki habere
uygulanıyor. Eleme işini düz kod ve ucuz model yapıyor. Her sayı paranın
nereye gittiğini yazıyor:

```
enrich   gpt-5.1     $0.0592   12 çağrı
score    gpt-5-mini  $0.0182    3 çağrı
compose  gpt-5.1     $0.0083    1 çağrı
```

Mimari sayıya dökülmüş hali bu: pahalı model harcamanın %69'u ama yalnızca on
iki habere, ucuz model %21 ile doksan adaya.

### Hafıza neden önemli

`data/<alan>/seen.json` yalnızca **yayınlanmış** haberleri tutuyor. Sonuç:

- aynı haber iki hafta üst üste bültene giremez;
- bu hafta elenen bir haber, gelecek hafta olgunlaşırsa tekrar değerlendirilir;
- derleme adımına geçen sayının başlıkları verilir, böylece "geçen hafta
  duyurulan X bu hafta yayınlandı" gibi bir süreklilik kurulabilir.

## Ajan mı, hat mı?

İkisi de — her biri ait olduğu yerde. Bu ayrım deponun asıl derdi:

> **Açık uçlu ve bir kez çalışan iş → ajan. Tekrarlanan ve öngörülebilir olması
> gereken iş → hat.**

Kaynak keşfi açık uçlu: bir konu yazıyorsunuz ve birinin gidip kaynak araması
gerekiyor. Bu bir ajanın işi, bir kez çalışıyor ve adım sayısının belirsiz
olması sorun değil.

Haftalık sayıyı üretmek açık uçlu değil. Her seferinde aynı altı adım, ve
çıktının şekli ile maliyetinin bilinmesi gerekiyor. Ajan döngüsü her
çalıştırmada farklı sayıda adım atar, maliyeti ne çıkarsa odur ve çıktısının
şekli garanti değildir.

Preset dosyası bu iki yarı arasındaki sözleşme.

`src/agent/research-agent.ts` bu argümanın sergilenen kanıtı olarak duran bir
tool-calling döngüsü. Çalışıyor, ve bülteni üretmek için kasten kullanılmıyor:

```bash
npm run research -- "AI agent memory"
```

## Kendi alanını tanımlamak

`presets/` altına bir JSON dosyası koyun. Dosya adı alanın kimliği olur ve
dosya yüklenirken alan alan doğrulanır — kırk saniye sonra bir model
çağrısının içinde patlamak yerine.

```jsonc
// presets/kahve.json  →  npm start kahve
{
  "name": "Kahve",                   // seçim ekranında görünen ad
  "title": "Kahve Radar",            // bültenin başlığı
  "tagline": "Haftalık kahve bülteni",
  "language": "tr",                  // çıktı dili; prompt'lar buna uyar
  "audience": "Kavurmacılar ve kafe işletmecileri",
  "topics": ["yeşil kahve fiyatları", "kavurma ekipmanı", "..."],
  "categories": ["Piyasa", "Ekipman", "Ticaret"],  // başlık olarak basılır
  "shortlist": 12,
  "minScore": 6,
  "feeds": [{ "name": "Perfect Daily Grind", "url": "https://..." }],
  "hackerNews": { "enabled": false, "minPoints": 100, "queries": [] },
  "webSearch": { "enabled": true, "queries": ["kahve sektörü haberleri"] }
}
```

Bilinmesi gereken üç şey:

- **`language` prompt'ları da yönetiyor**, sadece tarih biçimini değil. Prompt
  gövdeleri İngilizce ve yalnızca çıktı dili değişiyor; yani bir preset bu
  README'nin konuşmadığı bir dili hedefleyebilir.
- **Gürültülü bir kaynağa kendi `"max": 8`'ini verin.** arXiv günde yüzlerce
  kayıt üretir ve yoksa havuzu doldurur.
- **`topics` dar olsun.** "Her şey" yazarsanız puanlama neyi eleyeceğini
  bilemez.

## Bir sayıyı incelemek

```bash
npm run inspect ai 2026-W38
```

Puan dağılımını, kaynak bazlı huniyi (taranan → puanlanan → yayınlanan) ve
domain dağılımını basar. Puanlanan her aday — elenenler dahil — arşivde
duruyor; yani "X neden girmedi?" sorusunu cevaplayabilir, ve puanlayıcıdaki
bir değişikliği her seferinde canlı çalıştırma ödemek yerine **bedava ve
çevrimdışı** ölçebilirsiniz.

```bash
npm run render          # sayfaları arşivlerden yeniden üret, API çağrısı yok
```

Hem CI'da yayına almak için, hem düzenleme için:
`data/<alan>/archive/<sayı>.json` içinde bir özeti düzeltip yeniden üretin.

## Anahtarlar

| Değişken | Zorunlu mu | Nereden |
| --- | --- | --- |
| `OPENAI_API_KEY` | Evet | https://platform.openai.com/api-keys |
| `TAVILY_API_KEY` | Hayır | https://app.tavily.com/ |
| `RADAR_SITE_URL` | Hayır | sitenin yayınlandığı adres; geçerli RSS için gerekli |

Tavily anahtarı yoksa web araması atlanır, bülten yalnızca RSS ve Hacker News
ile üretilir.

## Bilinen sınırlar

- `readSource` sayfaları düzenli ifadelerle metne indirger. JavaScript ile
  render edilen sitelerde içerik zayıf gelir ve özet, arama özetine düşer.
- Yanıt vermeyen bir kaynak uyarı basar ve atlanır; bülteni durdurmaz.
- **Puanlama kısa listeyi tek başına ayıramıyor.** 84 gerçek aday üzerinde
  ölçüldü: yayınlanan 12 yerin 8'i eşit puanlı adaylardan dolduruluyor — yani
  ayırt etme işini puan değil, `select.ts`'teki eşitlik bozma kuralı yapıyor.
  Tek 0-10 yerine iki 0-5 ekseni denendi, daha iyi çıkmadı. Asıl çözüm en iyi
  ~25 aday için ikinci bir *sıralama* çağrısı; yazılmadı.
- Kaynak keşfi yarım: feed bulma, doğrulama ve dil tespiti çalışıyor ve gerçek
  sitelerde 16/20 ölçüldü. Konuyu aday sitelere çeviren katman henüz yok.
- `src/llm.ts` içindeki fiyat tablosu birkaç model biliyor. Diğerleri yine
  çalışır ama raporlanan maliyet eksik kalır ve uyarı basılır.
- Yayıncı başına çeşitlilik sınırı, tam kamu son ek listesi yerine küçük bir
  çok parçalı uzantı tablosu kullanıyor.

## Lisans

MIT
