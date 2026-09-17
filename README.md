# AI Radar

**A curation pipeline that doesn't know what it's about.** Point it at a topic,
get a weekly briefing — scanned, deduplicated, scored and rendered as a page
you can publish. About six cents an issue.

The word "AI" appears in no prompt in this repository. The domain lives
entirely in a JSON file, so `presets/cycling.json` gives you a cycling
briefing with no code change.

*[Türkçe README](README.tr.md)*

Node 22 or newer, then:

```bash
npm install
npm start
```

The first run asks which domain you want, takes your API key, writes it to
`.env`, produces the issue and opens it in your browser. There is no other
setup step.

The interface speaks English or Turkish, following your system locale. Pin it
with `RADAR_LANG=en` (or `tr`), which also sets the default `--lang` for
source discovery. The language of what gets *published* is a separate thing,
and it lives in each preset's `language` field.

<!--
Screenshot: open dist/ai/2026-W38.html in a browser, capture it, save it as
docs/screenshot.png, then replace this comment with the line below.

![A generated issue](docs/screenshot.png)
-->

## Who this is for

Not people who want to *read* a briefing — they can subscribe to one. This is
for people who have to **publish** one: an engineer sending a weekly internal
radar, someone covering a niche or a language where no good briefing exists,
a writer who wants a draft to edit rather than a blank page.

## Starting from a topic

You do not have to assemble the feed list yourself.

```bash
npm run discover -- "road cycling" --lang en
npm run ui            # the same thing with a browser, on localhost:3000
```

It works out what to search for, collects candidate sites, finds and validates
each one's feed, ranks them on their real headlines, shows you the list, and
writes the preset from what you approve.

The rule that makes this safe: **a model never produces a URL that reaches the
preset.** Model output is a hint; every address is fetched and parsed, and only
verified feeds survive. That removes the entire "the model invented a source"
failure class.

Approval is not optional. Discovery finds rubbish too, and `--yes` exists only
so CI can run — it is a deliberate flag, not a default.

## What comes out

Running `npm start yazilim` writes:

| File | What it is |
| --- | --- |
| `dist/yazilim/2026-W38.html` | The issue — one file, dark mode included |
| `dist/yazilim/2026-W38.md` | Markdown to paste into LinkedIn, Slack or Medium |
| `dist/yazilim/index.html` | That domain's archive |
| `dist/yazilim/feed.xml` | An RSS feed (needs `siteUrl`; see below) |
| `dist/index.html` | A cover page listing every domain |

## How it works

There is no free-running agent loop here. There are six steps, each giving the
model one narrow job, which is why the output has the same shape every week
and the cost is predictable.

```
1. COLLECT      RSS + Hacker News + web search           → ~940 candidates
2. DEDUPLICATE  canonical URL + title similarity         → repeats dropped
   │            data/<domain>/seen.json                  → past issues excluded
3. SCORE        cheap model, batches of 30, 0-10         → ~90 rated
4. ENRICH       only the shortlist gets fetched          → 12 stories
   │            each gets a tldr, a why-it-matters, tags
5. COMPOSE      an editor pass: intro, lead story, order
6. PUBLISH      HTML + Markdown + archive + RSS + cover
```

The expensive work — fetching full pages, running the strong model — touches
only the final twelve. The filtering is done by plain code and a cheap model.
Every issue prints where the money went:

```
enrich   gpt-5.1     $0.0592   12 calls
score    gpt-5-mini  $0.0182    3 calls
compose  gpt-5.1     $0.0083    1 call
```

That is the architecture as a number: the expensive model is 69% of the spend
across twelve items, the cheap one 21% across ninety candidates.

### Why the memory matters

`data/<domain>/seen.json` records only what was **published**. So:

- the same story cannot appear two weeks running;
- a story cut this week is reconsidered next week if it grows legs;
- the composer is shown last week's headlines, so it can say "the X announced
  last week shipped today".

## Agent or pipeline?

Both, in the places each belongs. That split is the point of this repository:

> **Open-ended work that runs once → an agent. Repeated work that has to be
> predictable → a pipeline.**

Source discovery is open-ended: you type a topic and something has to go look
for sources. That is an agent's job, it runs once, and an unpredictable number
of steps is fine.

Producing the weekly issue is not open-ended. It is the same six steps every
time, and it needs a stable shape and a known cost. An agent loop takes a
different number of steps on every run, costs what it costs, and guarantees
nothing about the shape of its output.

The preset file is the contract between the two halves.

`src/agent/research-agent.ts` is a tool-calling loop kept as the exhibit for
that argument. It works, and it is deliberately not used to build the issue:

```bash
npm run research -- "AI agent memory"
```

## Defining your own domain

Drop a JSON file into `presets/`. The filename becomes the domain id, and it
is validated on load with per-field messages rather than failing forty seconds
later inside a model call.

```jsonc
// presets/cycling.json  →  npm start cycling
{
  "name": "Cycling",                 // shown in the picker
  "title": "Cycling Radar",          // the briefing's masthead
  "tagline": "A weekly cycling briefing",
  "language": "en",                  // output language; prompts follow it
  "audience": "Racers and bike shop owners",
  "topics": ["frame and groupset releases", "race results", "..."],
  "categories": ["Racing", "Kit", "Industry"],  // rendered as headings
  "shortlist": 12,
  "minScore": 6,
  "feeds": [{ "name": "CyclingTips", "url": "https://..." }],
  "hackerNews": { "enabled": false, "minPoints": 100, "queries": [] },
  "webSearch": { "enabled": true, "queries": ["cycling industry news"] }
}
```

Three things worth knowing:

- **`language` drives the prompts**, not just the date format. Prompt bodies
  are English and only the output language varies, so a preset can target a
  language this README does not speak.
- **Give a noisy feed its own `"max": 8`.** arXiv publishes hundreds a day and
  will otherwise crowd out everything else.
- **Keep `topics` narrow.** "Everything" gives the scorer nothing to cut on.

## Inspecting an issue

```bash
npm run inspect ai 2026-W38
```

Prints the score distribution, the per-source funnel (scanned → scored →
published) and the domain spread. Every scored candidate is kept in the
archive, including the ones that were cut, so you can ask why something did
not make it — and evaluate a change to the scorer offline, for free, instead
of paying for a live run each time.

```bash
npm run render          # rebuild every page from the archives, no API calls
npm run health ai       # which feeds actually earn their place
```

`render` is how the site is published in CI, and how you edit: fix a summary
in `data/<domain>/archive/<issue>.json` and re-render.

`health` reads the funnel the archive already records — scanned, scored and
published per source — so a feed that produces volume and no results becomes
visible. It only ever recommends, and only after three issues; quietly
rewriting your preset would be a bad default, and one bad week is not
evidence.

## Publishing on a schedule

The weekly run is **not** automated by default. `.github/workflows/bulletin.yml`
has a `workflow_dispatch` trigger and no `schedule:`, so it never fires on its
own: an issue costs money and goes out under your name, so a person starts it.

To run one from GitHub:

1. Add `OPENAI_API_KEY` as a repository secret (Settings → Secrets and
   variables → Actions). `TAVILY_API_KEY` is optional; without it web search is
   skipped.
2. Actions → **bulletin** → *Run workflow*, and type the domain — the preset
   file name without `.json`, e.g. `yazilim`.
3. The run builds the issue, commits `data/`, and that commit makes the `pages`
   workflow republish the site. Untick **commit** for a trial run: the pages
   are still uploaded as a build artifact, so you can read the issue before
   anything is published.

Nothing has to be switched off afterwards — with no `schedule:` the workflow is
already idle. To make it weekly, add the block and mean it:

```yaml
on:
  schedule:
    - cron: "0 6 * * 1"   # Mondays, 06:00 UTC
  workflow_dispatch:
```

A run in CI starts from a fresh checkout, where `seen.json` does not exist
because it is not committed. The index of already-published stories is rebuilt
from the archived issues instead, so last week's stories stay out of this
week's.

## Keys

| Variable | Required | Where from |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | https://platform.openai.com/api-keys |
| `TAVILY_API_KEY` | no | https://app.tavily.com/ |
| `RADAR_SITE_URL` | no | where the site is published; needed for valid RSS |

Without a Tavily key, web search is skipped and the issue is built from RSS
and Hacker News alone.

## Layout

```
src/
  bulletin.ts            # the weekly run
  render.ts              # rebuild pages from archives (no model calls)
  inspect.ts             # score histogram and source funnel
  config.ts              # preset loading
  config-validate.ts     # preset contract, checked on load
  llm.ts                 # schema-bound calls + per-stage cost ledger
  i18n.ts                # content language vs interface language
  store.ts               # per-domain memory and archive
  pipeline/
    collect.ts  dedupe.ts  score.ts  select.ts
    enrich.ts   compose.ts render.ts stats.ts
  discover.ts            # topic → preset
  health.ts              # source efficiency report
  discovery/
    feed-links.ts  feed-health.ts  find-feed.ts   # deterministic: find a feed
    language.ts    decode.ts       net.ts
    brief.ts       candidates.ts   rank.ts        # model-assisted: which sources
    profile.ts     preset-build.ts approve.ts
  server/                # npm run ui: two screens, SSE, no dependencies
  agent/research-agent.ts
  tools/                 # web search, page reading, knowledge notes
  util/                  # http, concurrency, urls, dates, seeded shuffle
presets/                 # domain definitions
data/<domain>/           # seen.json + archived issues
test/                    # node:test, no extra dependencies
```

```bash
npm run check            # typecheck + tests
```

## Known limits

- `readSource` reduces pages to text with regular expressions. On
  JavaScript-rendered sites the content comes back thin and the summary falls
  back to the search snippet.
- A source that does not answer prints a warning and is skipped; it does not
  stop the issue.
- **Scoring does not separate the shortlist on its own.** Measured over 84
  real candidates, 8 of the 12 published slots were filled from items sharing
  a score — so the tie-break in `select.ts` is doing the work, not the score.
  Two 0-5 axes were tried instead of one 0-10 and measured no better. The real
  fix is a second, comparative ranking pass over the top ~25; it is not built.
- Feed discovery resolves 16 of 20 real sites. The misses are sites that
  retired their feeds, never had one, or render their feed index with
  JavaScript. The approval step lets you paste an address by hand.
- The cost table in `src/llm.ts` knows a handful of models. Others still run,
  but the reported cost is short and a warning says so.
- The per-publisher diversity cap groups by registrable domain using a small
  table of multi-part suffixes, not the full public suffix list.

## Licence

MIT
