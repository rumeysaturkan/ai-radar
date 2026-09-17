import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { listPresets, type PresetSummary } from "./config.js";
import { color } from "./util/log.js";

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const lastPresetPath = fileURLToPath(
  new URL("../data/last-preset", import.meta.url),
);

async function readLastPreset(): Promise<string | null> {
  try {
    const value = (await readFile(lastPresetPath, "utf8")).trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

async function writeLastPreset(id: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(lastPresetPath, id + "\n", "utf8");
}

function render(presets: readonly PresetSummary[], defaultIndex: number): void {
  console.log("  Hangi alanda bülten üretilsin?");
  console.log("");

  presets.forEach((preset, index) => {
    const marker = index === defaultIndex ? color.cyan("›") : " ";
    console.log(`  ${marker} ${index + 1}) ${preset.name}`);
    console.log(
      `       ${color.dim(`${preset.tagline} · ${preset.feedCount} kaynak`)}`,
    );
  });

  console.log("");
}

export async function resolvePreset(argv: readonly string[]): Promise<string> {
  const presets = await listPresets();

  if (presets.length === 0) {
    throw new Error("Hiç alan tanımlı değil. presets/ klasörüne bir .json ekle.");
  }

  const requested = argv.find((arg) => !arg.startsWith("-"));

  if (requested) {
    const match = presets.find(
      (preset) => preset.id === requested || preset.name === requested,
    );

    if (!match) {
      const known = presets.map((preset) => preset.id).join(", ");
      throw new Error(
        `"${requested}" diye bir alan yok. Tanımlı alanlar: ${known}`,
      );
    }

    await writeLastPreset(match.id);
    return match.id;
  }

  const last = await readLastPreset();
  const lastIndex = presets.findIndex((preset) => preset.id === last);
  const defaultIndex = lastIndex >= 0 ? lastIndex : 0;
  const fallback = presets[defaultIndex]!;

  if (!process.stdin.isTTY) {
    return fallback.id;
  }

  render(presets, defaultIndex);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const answer = (
        await rl.question(
          `  Seçim [1-${presets.length}, boş = ${fallback.name}]: `,
        )
      ).trim();

      if (answer === "") {
        await writeLastPreset(fallback.id);
        return fallback.id;
      }

      const byNumber = Number(answer);

      if (
        Number.isInteger(byNumber) &&
        byNumber >= 1 &&
        byNumber <= presets.length
      ) {
        const id = presets[byNumber - 1]!.id;
        await writeLastPreset(id);
        return id;
      }

      const byId = presets.find((preset) => preset.id === answer);

      if (byId) {
        await writeLastPreset(byId.id);
        return byId.id;
      }

      console.log(
        `  ${color.yellow("!")} ${color.dim("Listedeki bir numarayı ya da kimliği yaz.")}`,
      );
    }
  } finally {
    rl.close();
  }
}
