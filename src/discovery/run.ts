import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { presetPath } from "../config.js";
import { ui } from "../i18n.js";
import { usageSoFar } from "../llm.js";
import { color, done, note, step, warn } from "../util/log.js";
import { approveFeeds } from "./approve.js";
import { makeTopicBrief } from "./brief.js";
import { findCandidateSites } from "./candidates.js";
import { findFeeds, type FindFeedDeps } from "./find-feed.js";
import { fetchPage, parseFeedXml } from "./net.js";
import { buildPreset, checkPreset, slugifyId } from "./preset-build.js";
import { buildProfile } from "./profile.js";
import { rankFeeds } from "./rank.js";
import type { DiscoveryRequest, FeedFinding, RankedFeed } from "./types.js";

const MODELS = { cheap: "gpt-5-mini", strong: "gpt-5.1" };

function googleNewsFeed(topic: string, language: string): string {
  const region = language === "tr" ? "TR" : "US";
  const params = new URLSearchParams({
    q: topic,
    hl: language,
    gl: region,
    ceid: `${region}:${language}`,
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type DiscoveryEvent =
  | { kind: "step"; label: string }
  | { kind: "note"; label: string }
  | { kind: "done"; label: string };

export type DiscoverOptions = {
  assumeYes: boolean;
  force: boolean;
  id?: string;
  onEvent?: (event: DiscoveryEvent) => void;
};

export type DiscoveryOutcome = {
  ranked: RankedFeed[];
  rejected: FeedFinding[];
  deps: FindFeedDeps;
};

export async function discoverSources(
  request: DiscoveryRequest,
  options: { onEvent?: (event: DiscoveryEvent) => void } = {},
): Promise<DiscoveryOutcome | null> {
  const deps: FindFeedDeps = {
    fetchPage,
    parseFeed: parseFeedXml,
    now: () => new Date(),
  };

  const emit = options.onEvent;
  const emitStep = (label: string) => (emit ? emit({ kind: "step", label }) : step(label));
  const emitNote = (label: string) => (emit ? emit({ kind: "note", label }) : note(label));
  const emitDone = (label: string) => (emit ? emit({ kind: "done", label }) : done(label));

  emitStep(ui({ tr: "Konu çözümleniyor...", en: "Working out the topic..." }));
  const brief = await makeTopicBrief(request, MODELS.cheap);
  emitDone(
    ui(
      {
        tr: "{queries} sorgu, {seeds} tohum alan",
        en: "{queries} queries, {seeds} seed domains",
      },
      { queries: brief.searchQueries.length, seeds: brief.seedDomains.length },
    ),
  );

  emitStep(
    ui({ tr: "Aday kaynaklar aranıyor...", en: "Looking for candidate sources..." }),
  );
  const sites = await findCandidateSites(brief, emitNote);
  emitDone(
    ui(
      { tr: "{count} aday site", en: "{count} candidate sites" },
      { count: sites.length },
    ),
  );

  if (sites.length === 0) {
    warn(
      ui({
        tr: "Hiç aday site bulunamadı. Konuyu biraz daha genel yazmayı dene.",
        en: "No candidate sites at all. Try wording the topic more broadly.",
      }),
    );
    return null;
  }

  emitStep(
    ui(
      {
        tr: "{count} sitede feed aranıyor...",
        en: "Looking for a feed on {count} sites...",
      },
      { count: sites.length },
    ),
  );
  const findings = await findFeeds(sites, deps);
  const usable = findings.filter((finding) => finding.feed !== null);
  const rejected = findings.filter((finding) => finding.feed === null);
  const requests = findings.reduce((total, finding) => total + finding.requestCount, 0);
  emitDone(
    ui(
      {
        tr: "{count} feed doğrulandı ({requests} istek)",
        en: "{count} feeds verified ({requests} requests)",
      },
      { count: usable.length, requests },
    ),
  );

  if (usable.length === 0) {
    warn(
      ui({
        tr: "Doğrulanabilen hiç feed çıkmadı.",
        en: "Not one feed could be verified.",
      }),
    );
    emitNote(
      ui({
        tr:
          "Bu konuda RSS sunan kaynak bulunamadı. Google News akışıyla bir taban " +
          "preset kurulabilir ama içerik yalnızca arama özetinden gelir.",
        en:
          "No source in this topic offers RSS. A baseline preset can be built on a " +
          "Google News feed, but the content then comes only from search snippets.",
      }),
    );
    return null;
  }

  emitStep(ui({ tr: "Kaynaklar değerlendiriliyor...", en: "Rating the sources..." }));
  const ranked = await rankFeeds(usable, request, MODELS.cheap);
  emitDone(
    ui(
      { tr: "{count} kaynak öneriliyor", en: "{count} sources recommended" },
      { count: ranked.filter((feed) => feed.verdict === "keep").length },
    ),
  );

  return { ranked, rejected, deps };
}

export async function finalizePreset(
  request: DiscoveryRequest,
  accepted: readonly RankedFeed[],
  options: DiscoverOptions,
): Promise<string | null> {
  const emit = options.onEvent;
  const emitStep = (label: string) => (emit ? emit({ kind: "step", label }) : step(label));
  const emitNote = (label: string) => (emit ? emit({ kind: "note", label }) : note(label));
  const emitDone = (label: string) => (emit ? emit({ kind: "done", label }) : done(label));

  emitStep(
    ui({ tr: "Alan profili çıkarılıyor...", en: "Drawing up the domain profile..." }),
  );
  const profile = await buildProfile(request, accepted, MODELS.strong);
  emitDone(
    ui(
      {
        tr: "{categories} kategori, {topics} konu",
        en: "{categories} categories, {topics} topics",
      },
      { categories: profile.categories.length, topics: profile.topics.length },
    ),
  );

  const id = options.id ?? slugifyId(profile.name || request.topic);

  if (!id) {
    warn(
      ui(
        {
          tr: '"{topic}" bir dosya adına çevrilemedi. --id ile bir kimlik ver.',
          en: '"{topic}" could not be turned into a file name. Pass one with --id.',
        },
        { topic: request.topic },
      ),
    );
    return null;
  }

  const config = buildPreset({
    id,
    language: request.language,
    profile,
    accepted: accepted,
  });

  const problems = checkPreset(config);

  if (problems.length > 0) {
    warn(
      ui({
        tr: "Üretilen preset doğrulamadan geçmedi:",
        en: "The preset that was produced did not validate:",
      }),
    );

    for (const problem of problems) {
      emitNote(`- ${problem}`);
    }

    return null;
  }

  const path = presetPath(id);

  if ((await exists(path)) && !options.force) {
    if (!process.stdin.isTTY) {
      warn(
        ui(
          {
            tr: "presets/{id}.json zaten var. Üzerine yazmak için --force ver.",
            en: "presets/{id}.json already exists. Pass --force to overwrite it.",
          },
          { id },
        ),
      );
      return null;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      const answer = (
        await rl.question(
          ui(
            {
              tr: "  presets/{id}.json zaten var. Üzerine yazılsın mı? [e/H] ",
              en: "  presets/{id}.json already exists. Overwrite it? [y/N] ",
            },
            { id },
          ),
        )
      ).trim().toLowerCase();

      if (answer !== "e" && answer !== "y") {
        emitNote(ui({ tr: "Yazılmadı.", en: "Not written." }));
        return null;
      }
    } finally {
      rl.close();
    }
  }

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log("");
  console.log(
    `  ${color.green("✓")} ` +
      ui(
        { tr: "presets/{id}.json yazıldı", en: "presets/{id}.json written" },
        { id },
      ),
  );
  console.log(
    color.dim(
      "     " +
        ui(
          { tr: "{count} kaynak", en: "{count} sources" },
          { count: config.feeds.length },
        ) +
        ` · ${config.categories.join(", ")}`,
    ),
  );

  const usage = usageSoFar();
  console.log(
    color.dim(
      "     " +
        ui(
          { tr: "keşif maliyeti ${cost}", en: "discovery cost ${cost}" },
          { cost: usage.estimatedCostUsd.toFixed(4) },
        ),
    ),
  );
  console.log("");
  console.log(
    `  ${ui({ tr: "Şimdi:", en: "Next:" })}  ${color.bold(`npm start ${id}`)}`,
  );
  console.log("");

  return id;
}


export async function runDiscovery(
  request: DiscoveryRequest,
  options: DiscoverOptions,
): Promise<string | null> {
  const outcome = await discoverSources(request, options);

  if (!outcome) {
    return null;
  }

  const approval = await approveFeeds(
    outcome.ranked,
    outcome.rejected,
    request,
    outcome.deps,
    { assumeYes: options.assumeYes },
  );

  if (approval.aborted || approval.accepted.length === 0) {
    note(
      ui({
        tr: "Vazgeçildi, preset yazılmadı.",
        en: "Cancelled; no preset was written.",
      }),
    );
    return null;
  }

  return finalizePreset(request, approval.accepted, options);
}

export { googleNewsFeed };
