import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ui } from "./i18n.js";
import { verifyApiKey } from "./llm.js";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.trim() === "" || value.trim().endsWith("...");
}

async function readEnvFile(): Promise<string> {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return "";
  }
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  return content.trimEnd() === ""
    ? line + "\n"
    : content.trimEnd() + "\n" + line + "\n";
}

export async function ensureKeys(): Promise<void> {
  const needsOpenAi = isPlaceholder(process.env.OPENAI_API_KEY);
  const needsTavily = isPlaceholder(process.env.TAVILY_API_KEY);

  if (!needsOpenAi && !needsTavily) {
    return;
  }

  if (!process.stdin.isTTY) {
    if (needsOpenAi) {
      throw new Error(
        ui({
          tr:
            "OPENAI_API_KEY tanımlı değil. Etkileşimsiz bir ortamda anahtar " +
            "sorulamaz; ortam değişkeni olarak ver.",
          en:
            "OPENAI_API_KEY is not set. A key cannot be asked for in a " +
            "non-interactive environment; pass it as an environment variable.",
        }),
      );
    }

    return;
  }

  let content = await readEnvFile();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (needsOpenAi) {
      console.log(
        ui({
          tr: "  Kurulum — anahtarlar .env dosyasına kaydedilecek.",
          en: "  Setup — the keys are saved to the .env file.",
        }),
      );
      console.log(
        ui({
          tr: "  OpenAI anahtarı: https://platform.openai.com/api-keys\n",
          en: "  OpenAI key: https://platform.openai.com/api-keys\n",
        }),
      );

      const key = (await rl.question("  OPENAI_API_KEY: ")).trim();

      if (!key) {
        throw new Error(
          ui({
            tr: "OpenAI anahtarı olmadan bülten üretilemez.",
            en: "No issue can be produced without an OpenAI key.",
          }),
        );
      }

      process.env.OPENAI_API_KEY = key;
      content = upsertEnvLine(content, "OPENAI_API_KEY", key);
    }

    if (needsTavily) {
      console.log(
        ui({
          tr: "\n  Tavily anahtarı opsiyonel; boş bırakırsan sadece RSS kaynakları taranır.",
          en: "\n  The Tavily key is optional; leave it empty and only RSS is scanned.",
        }),
      );
      console.log(
        ui({
          tr: "  Ücretsiz anahtar: https://app.tavily.com/\n",
          en: "  Free key: https://app.tavily.com/\n",
        }),
      );

      const key = (
        await rl.question(
          ui({
            tr: "  TAVILY_API_KEY (boş geçilebilir): ",
            en: "  TAVILY_API_KEY (optional): ",
          }),
        )
      ).trim();

      if (key) {
        process.env.TAVILY_API_KEY = key;
        content = upsertEnvLine(content, "TAVILY_API_KEY", key);
      }
    }
  } finally {
    rl.close();
  }

  await writeFile(envPath, content, "utf8");

  process.stdout.write(
    ui({ tr: "\n  Anahtar doğrulanıyor... ", en: "\n  Verifying the key... " }),
  );
  await verifyApiKey();
  console.log(
    ui({
      tr: "tamam. .env dosyasına kaydedildi.\n",
      en: "done. Saved to .env.\n",
    }),
  );
}
