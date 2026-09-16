import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
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

/** Var olan satırı günceller, yoksa dosyanın sonuna ekler. */
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

  let content = await readEnvFile();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (needsOpenAi) {
      console.log("  Kurulum — anahtarlar .env dosyasına kaydedilecek.");
      console.log("  OpenAI anahtarı: https://platform.openai.com/api-keys\n");

      const key = (await rl.question("  OPENAI_API_KEY: ")).trim();

      if (!key) {
        throw new Error("OpenAI anahtarı olmadan bülten üretilemez.");
      }

      process.env.OPENAI_API_KEY = key;
      content = upsertEnvLine(content, "OPENAI_API_KEY", key);
    }

    if (needsTavily) {
      console.log(
        "\n  Tavily anahtarı opsiyonel; boş bırakırsan sadece RSS kaynakları taranır.",
      );
      console.log("  Ücretsiz anahtar: https://app.tavily.com/\n");

      const key = (await rl.question("  TAVILY_API_KEY (boş geçilebilir): ")).trim();

      if (key) {
        process.env.TAVILY_API_KEY = key;
        content = upsertEnvLine(content, "TAVILY_API_KEY", key);
      }
    }
  } finally {
    rl.close();
  }

  await writeFile(envPath, content, "utf8");

  process.stdout.write("\n  Anahtar doğrulanıyor... ");
  await verifyApiKey();
  console.log("tamam. .env dosyasına kaydedildi.\n");
}
