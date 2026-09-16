import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type KnowledgeEntry = {
  path: string;
  title: string;
  content: string;
};

const knowledgeDir = fileURLToPath(
  new URL("../../knowledge/", import.meta.url),
);

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractTitle(content: string, fallback: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() ?? fallback;
}

export async function readKnowledge(topic: string): Promise<KnowledgeEntry> {
  const files = await findMarkdownFiles(knowledgeDir);

  const needle = topic.toLowerCase().replace(/\.md$/, "");

  const match =
    files.find((file) => file.toLowerCase().endsWith(needle + ".md")) ??
    files.find((file) => file.toLowerCase().includes(needle));

  if (!match) {
    throw new Error(`No knowledge found for topic: ${topic}`);
  }

  const content = await readFile(match, "utf8");
  const relativePath = path.relative(knowledgeDir, match).replace(/\\/g, "/");

  return {
    path: relativePath,
    title: extractTitle(content, relativePath),
    content,
  };
}
