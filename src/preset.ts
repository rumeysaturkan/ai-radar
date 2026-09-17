import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { listPresets, type PresetSummary } from "./config.js";
import { ui } from "./i18n.js";
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
  console.log(
    ui({
      tr: "  Hangi alanda bülten üretilsin?",
      en: "  Which domain should the issue come from?",
    }),
  );
  console.log("");

  presets.forEach((preset, index) => {
    const marker = index === defaultIndex ? color.cyan("›") : " ";
    console.log(`  ${marker} ${index + 1}) ${preset.name}`);
    console.log(
      `       ${color.dim(
         `${preset.tagline} · ` +
           ui(
             { tr: "{count} kaynak", en: "{count} sources" },
             { count: preset.feedCount },
           ),
       )}`,
    );
  });

  console.log("");
}

export async function resolvePreset(argv: readonly string[]): Promise<string> {
  const presets = await listPresets();

  if (presets.length === 0) {
    throw new Error(
      ui({
        tr: "Hiç alan tanımlı değil. presets/ klasörüne bir .json ekle.",
        en: "No domains are defined. Add a .json file to presets/.",
      }),
    );
  }

  const requested = argv.find((arg) => !arg.startsWith("-"));

  if (requested) {
    const match = presets.find(
      (preset) => preset.id === requested || preset.name === requested,
    );

    if (!match) {
      const known = presets.map((preset) => preset.id).join(", ");
      throw new Error(
        ui(
          {
            tr: '"{requested}" diye bir alan yok. Tanımlı alanlar: {known}',
            en: 'There is no domain called "{requested}". Defined: {known}',
          },
          { requested, known },
        ),
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
          ui(
            {
              tr: "  Seçim [1-{count}, boş = {fallback}]: ",
              en: "  Pick [1-{count}, empty = {fallback}]: ",
            },
            { count: presets.length, fallback: fallback.name },
          ),
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
        `  ${color.yellow("!")} ${color.dim(
          ui({
            tr: "Listedeki bir numarayı ya da kimliği yaz.",
            en: "Type a number from the list, or an id.",
          }),
        )}`,
      );
    }
  } finally {
    rl.close();
  }
}
