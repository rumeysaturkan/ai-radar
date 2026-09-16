import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UpdateKnowledgeResult = {
  path: string;
  created: boolean;
};

const knowledgeDir = fileURLToPath(
  new URL("../../knowledge/", import.meta.url),
);

function resolveSafePath(relativePath: string): string {
  const normalized = relativePath.endsWith(".md")
    ? relativePath
    : relativePath + ".md";

  const target = path.resolve(knowledgeDir, normalized);
  const relative = path.relative(knowledgeDir, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the knowledge directory: ${relativePath}`);
  }

  return target;
}

async function readExisting(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

export async function updateKnowledge(
  relativePath: string,
  content: string,
): Promise<UpdateKnowledgeResult> {
  const target = resolveSafePath(relativePath);

  const existing = await readExisting(target);
  const created = existing === null;

  const trimmed = content.trim();
  const updated = created
    ? trimmed + "\n"
    : existing.trimEnd() + "\n\n" + trimmed + "\n";

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, updated, "utf8");

  return {
    path: path.relative(knowledgeDir, target).replace(/\\/g, "/"),
    created,
  };
}
