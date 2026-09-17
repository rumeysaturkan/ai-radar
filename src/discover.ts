import { runDiscovery } from "./discovery/run.js";
import { resolveLang, ui, uiLang } from "./i18n.js";
import { ensureKeys } from "./setup.js";
import { banner } from "./util/log.js";

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);

  if (index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
    return argv[index + 1];
  }

  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  return inline?.slice(`--${name}=`.length);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const topic = argv.filter((arg) => !arg.startsWith("--")).join(" ").trim();

  if (!topic) {
    console.error(
      ui({
        tr: [
          "",
          "  Kullanım: npm run discover -- <konu> [--lang tr|en] [--id kimlik]",
          "",
          '  Örnek:    npm run discover -- "kahve sektörü" --lang tr',
          '            npm run discover -- "game industry" --lang en',
          "",
          "  Seçenekler:",
          `    --lang <kod>   tercih edilen kaynak dili (varsayılan ${uiLang()})`,
          "    --id <kimlik>  preset dosya adı (varsayılan konudan türetilir)",
          "    --max <sayı>   en fazla kaç kaynak seçilsin (varsayılan 12)",
          "    --yes          onay sorma (CI için)",
          "    --force        var olan preset'in üzerine yaz",
          "",
        ].join("\n"),
        en: [
          "",
          "  Usage: npm run discover -- <topic> [--lang tr|en] [--id name]",
          "",
          '  Example: npm run discover -- "game industry" --lang en',
          '           npm run discover -- "kahve sektörü" --lang tr',
          "",
          "  Options:",
          `    --lang <code>  preferred source language (default ${uiLang()})`,
          "    --id <name>    preset file name (derived from the topic by default)",
          "    --max <n>      how many sources at most (default 12)",
          "    --yes          skip approval (for CI)",
          "    --force        overwrite an existing preset",
          "",
        ].join("\n"),
      }),
    );
    process.exitCode = 1;
    return;
  }

  const language = resolveLang(flagValue(argv, "lang") ?? uiLang());
  const maxFeeds = Number(flagValue(argv, "max") ?? 12);

  banner(ui({ tr: "Kaynak keşfi", en: "Source discovery" }), topic);

  await ensureKeys();

  const id = await runDiscovery(
    {
      topic,
      language,
      windowDays: 7,
      maxFeeds: Number.isInteger(maxFeeds) && maxFeeds > 0 ? maxFeeds : 12,
      strictLanguage: argv.includes("--strict-language"),
    },
    {
      assumeYes: argv.includes("--yes"),
      force: argv.includes("--force"),
      ...(flagValue(argv, "id") ? { id: flagValue(argv, "id")! } : {}),
    },
  );

  if (!id) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n  Hata: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
