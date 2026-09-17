import { createInterface } from "node:readline/promises";
import { ui } from "../i18n.js";
import { color } from "../util/log.js";
import { domainOf } from "../util/url.js";
import type { FindFeedDeps } from "./find-feed.js";
import { findFeedForSite } from "./find-feed.js";
import type { DiscoveryRequest, FeedFinding, RankedFeed } from "./types.js";

function describe(feed: RankedFeed): string {
  const health = feed.health;
  const parts: string[] = [domainOf(feed.site.origin)];

  if (health) {
    parts.push(
      ui(
        { tr: "{count}/hafta", en: "{count}/week" },
        { count: health.itemsPerWeek.toFixed(0) },
      ),
    );

    if (health.daysSinceLastPost !== null && health.daysSinceLastPost > 30) {
      parts.push(
        color.yellow(
          ui(
            {
              tr: "son yazı {days} gün önce",
              en: "last post {days} days ago",
            },
            { days: health.daysSinceLastPost },
          ),
        ),
      );
    }

    const language = health.declaredLanguage ?? health.detectedLanguage;

    if (language) {
      parts.push(language);
    }
  }

  return parts.join(" · ");
}

function render(feeds: readonly RankedFeed[], chosen: ReadonlySet<number>): void {
  console.log("");

  feeds.forEach((feed, index) => {
    const mark = chosen.has(index) ? color.green("✓") : " ";
    const score = String(feed.credibility).padStart(2);

    console.log(
      `  ${mark} ${String(index + 1).padStart(2)}) ${color.bold(feed.suggestedName)}  ${color.dim(`[${score}/10]`)}`,
    );
    console.log(`        ${color.dim(describe(feed))}`);

    if (feed.reason) {
      console.log(`        ${color.dim(feed.reason.slice(0, 84))}`);
    }
  });

  console.log("");
}

export type ApprovalResult = {
  accepted: RankedFeed[];
  aborted: boolean;
};

export async function approveFeeds(
  feeds: readonly RankedFeed[],
  rejected: readonly FeedFinding[],
  request: DiscoveryRequest,
  deps: FindFeedDeps,
  options: { assumeYes: boolean },
): Promise<ApprovalResult> {
  const pool = [...feeds];

  const chosen = new Set<number>();

  pool.forEach((feed, index) => {
    if (feed.verdict === "keep" && chosen.size < request.maxFeeds) {
      chosen.add(index);
    }
  });

  const interactive = process.stdin.isTTY && !options.assumeYes;

  if (!interactive) {
    if (!options.assumeYes) {
      console.error(
        ui({
          tr:
            "\n  Etkileşimli olmayan ortamda onay alınamıyor. Gözden geçirmeden\n" +
            "  devam etmek için --yes ver.\n",
          en:
            "\n  Approval cannot be collected in a non-interactive environment.\n" +
            "  Pass --yes to go ahead without reviewing.\n",
        }),
      );
      return { accepted: [], aborted: true };
    }

    return { accepted: [...chosen].map((index) => pool[index]!), aborted: false };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      render(pool, chosen);

      console.log(
        color.dim(
          ui(
            {
              tr:
                "  {count} kaynak seçili. [enter] onayla · [numara] aç/kapat · " +
                "[+ adres] ekle · [-] elenenler · [q] vazgeç",
              en:
                "  {count} sources selected. [enter] confirm · [number] toggle · " +
                "[+ address] add · [-] rejected · [q] quit",
            },
            { count: chosen.size },
          ),
        ),
      );

      const answer = (await rl.question("  > ")).trim();

      if (answer === "") {
        if (chosen.size === 0) {
          console.log(
            `  ${color.yellow("!")} ` +
              ui({ tr: "En az bir kaynak seç.", en: "Pick at least one source." }),
          );
          continue;
        }

        return {
          accepted: [...chosen].sort((a, b) => a - b).map((index) => pool[index]!),
          aborted: false,
        };
      }

      if (answer === "q") {
        return { accepted: [], aborted: true };
      }

      if (answer === "-") {
        console.log("");

        if (rejected.length === 0) {
          console.log(color.dim("  Elenen kaynak yok."));
        }

        for (const finding of rejected) {
          console.log(
            `  ${color.dim(domainOf(finding.site.origin).padEnd(30))} ` +
              `${color.dim(finding.status)}${finding.error ? color.dim(` — ${finding.error.slice(0, 40)}`) : ""}`,
          );
        }

        continue;
      }

      if (answer.startsWith("+")) {
        const url = answer.slice(1).trim();

        if (!url) {
          continue;
        }

        console.log(
          color.dim(
            ui({ tr: "  {url} kontrol ediliyor...", en: "  checking {url}..." }, { url }),
          ),
        );

        let origin: string;

        try {
          origin = new URL(url.startsWith("http") ? url : `https://${url}`).origin;
        } catch {
          console.log(
            `  ${color.yellow("!")} ` +
              ui({
                tr: "Adres çözümlenemedi.",
                en: "That address could not be parsed.",
              }),
          );
          continue;
        }

        const finding = await findFeedForSite(
          {
            name: domainOf(origin),
            url,
            origin,
            why: ui({ tr: "elle eklendi", en: "added by hand" }),
            via: "search",
          },
          deps,
        );

        if (!finding.feed) {
          console.log(
            `  ${color.yellow("!")} ` +
              ui(
                {
                  tr: "Feed bulunamadı ({status}). Doğrudan feed adresini verebilirsin.",
                  en: "No feed found ({status}). You can give the feed address directly.",
                },
                { status: finding.status },
              ),
          );
          continue;
        }

        pool.push({
          ...finding,
          credibility: 10,
          verdict: "keep",
          reason: ui({ tr: "elle eklendi", en: "added by hand" }),
          suggestedName: finding.health?.feedTitle ?? domainOf(origin),
        });
        chosen.add(pool.length - 1);
        continue;
      }

      const numbers = answer
        .split(/[\s,]+/)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= pool.length);

      if (numbers.length === 0) {
        console.log(
          `  ${color.yellow("!")} ` +
            ui({ tr: "Anlaşılmadı.", en: "Did not understand that." }),
        );
        continue;
      }

      for (const number of numbers) {
        const index = number - 1;

        if (chosen.has(index)) {
          chosen.delete(index);
        } else {
          chosen.add(index);
        }
      }
    }
  } finally {
    rl.close();
  }
}
