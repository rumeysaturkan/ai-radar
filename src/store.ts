import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Issue } from "./types.js";

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));

function presetDir(presetId: string): string {
  return path.join(dataDir, presetId);
}

function archiveDirOf(presetId: string): string {
  return path.join(presetDir(presetId), "archive");
}

function seenPathOf(presetId: string): string {
  return path.join(presetDir(presetId), "seen.json");
}

export type SeenEntry = {
  url: string;
  title: string;
  firstSeen: string;
};

export type SeenIndex = Record<string, SeenEntry>;

const SEEN_RETENTION_DAYS = 120;

export function hashUrl(canonicalUrl: string): string {
  return createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 12);
}

function withinRetention(index: SeenIndex, now: Date): SeenIndex {
  const cutoff = now.getTime() - SEEN_RETENTION_DAYS * 86_400_000;

  return Object.fromEntries(
    Object.entries(index).filter(
      ([, entry]) => new Date(entry.firstSeen).getTime() >= cutoff,
    ),
  );
}

export function seenFromIssues(
  issues: readonly Issue[],
  now: Date = new Date(),
): SeenIndex {
  const index: SeenIndex = {};

  for (const issue of [...issues].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const item of issue.items) {
      index[item.id] ??= {
        url: item.url,
        title: item.title,
        firstSeen: issue.generatedAt,
      };
    }
  }

  return withinRetention(index, now);
}

export async function readSeen(presetId: string): Promise<SeenIndex> {
  try {
    const raw = await readFile(seenPathOf(presetId), "utf8");
    const parsed = JSON.parse(raw) as SeenIndex;
    const index = withinRetention(parsed, new Date());

    if (Object.keys(index).length > 0) {
      return index;
    }
  } catch {
  }

  return seenFromIssues(await listIssues(presetId));
}

export async function writeSeen(
  presetId: string,
  index: SeenIndex,
): Promise<void> {
  await mkdir(presetDir(presetId), { recursive: true });
  await writeFile(
    seenPathOf(presetId),
    JSON.stringify(index, null, 2) + "\n",
    "utf8",
  );
}

export async function saveIssue(
  presetId: string,
  issue: Issue,
): Promise<void> {
  const dir = archiveDirOf(presetId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${issue.id}.json`),
    JSON.stringify(issue, null, 2) + "\n",
    "utf8",
  );
}

export async function listIssues(presetId: string): Promise<Issue[]> {
  const dir = archiveDirOf(presetId);
  let files: string[];

  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const issues: Issue[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    try {
      const raw = await readFile(path.join(dir, file), "utf8");
      issues.push(JSON.parse(raw) as Issue);
    } catch {
    }
  }

  return issues.sort((a, b) => b.id.localeCompare(a.id));
}
