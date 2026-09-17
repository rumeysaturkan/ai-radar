import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverSources, finalizePreset } from "../discovery/run.js";
import type { DiscoveryOutcome } from "../discovery/run.js";
import type { DiscoveryRequest, RankedFeed } from "../discovery/types.js";
import { resolveLang } from "../i18n.js";
import { color } from "../util/log.js";
import { domainOf } from "../util/url.js";
import { openStream } from "./sse.js";

const uiPath = fileURLToPath(new URL("./ui.html", import.meta.url));

type Session = {
  request: DiscoveryRequest;
  outcome: DiscoveryOutcome;
  createdAt: number;
};

const sessions = new Map<string, Session>();

const SESSION_TTL_MS = 60 * 60 * 1000;

function pruneSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;

  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      sessions.delete(id);
    }
  }
}

function summarise(feed: RankedFeed, index: number) {
  return {
    index,
    name: feed.suggestedName,
    domain: domainOf(feed.site.origin),
    feedUrl: feed.feed?.url ?? "",
    credibility: feed.credibility,
    verdict: feed.verdict,
    reason: feed.reason,
    itemsPerWeek: feed.health?.itemsPerWeek ?? 0,
    daysSinceLastPost: feed.health?.daysSinceLastPost ?? null,
    language: feed.health?.declaredLanguage ?? feed.health?.detectedLanguage ?? null,
    sampleTitles: (feed.health?.sampleTitles ?? []).slice(0, 3),
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    if (size > 1_000_000) {
      throw new Error("İstek gövdesi çok büyük");
    }

    chunks.push(chunk as Buffer);
  }

  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function handleDiscover(
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const topic = (url.searchParams.get("topic") ?? "").trim();

  if (!topic) {
    sendJson(response, 400, { error: "Konu boş olamaz." });
    return;
  }

  const request: DiscoveryRequest = {
    topic,
    language: resolveLang(url.searchParams.get("lang") ?? "tr"),
    windowDays: 7,
    maxFeeds: 12,
    strictLanguage: false,
  };

  const stream = openStream(response);

  try {
    const outcome = await discoverSources(request, {
      onEvent: (event) => stream.send(event.kind, event.label),
    });

    if (!outcome || outcome.ranked.length === 0) {
      stream.send("failed", "Bu konuda doğrulanabilen kaynak bulunamadı.");
      stream.close();
      return;
    }

    pruneSessions();

    const sessionId = randomUUID();
    sessions.set(sessionId, { request, outcome, createdAt: Date.now() });

    stream.send("sources", {
      sessionId,
      topic,
      feeds: outcome.ranked.map(summarise),
      rejected: outcome.rejected.map((finding) => ({
        domain: domainOf(finding.site.origin),
        status: finding.status,
      })),
    });
  } catch (error) {
    stream.send("failed", error instanceof Error ? error.message : String(error));
  } finally {
    stream.close();
  }
}

async function handlePreset(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJson(request)) as {
    sessionId?: string;
    selected?: number[];
    id?: string;
  };

  const session = body.sessionId ? sessions.get(body.sessionId) : undefined;

  if (!session) {
    sendJson(response, 410, {
      error: "Bu keşif oturumu artık yok. Yeniden çalıştır.",
    });
    return;
  }

  const selected = (body.selected ?? [])
    .map((index) => session.outcome.ranked[index])
    .filter((feed): feed is RankedFeed => feed !== undefined);

  if (selected.length === 0) {
    sendJson(response, 400, { error: "En az bir kaynak seç." });
    return;
  }

  const id = await finalizePreset(session.request, selected, {
    assumeYes: true,
    force: true,
    ...(body.id ? { id: body.id } : {}),
  });

  if (!id) {
    sendJson(response, 500, { error: "Preset üretilemedi." });
    return;
  }

  sessions.delete(body.sessionId!);
  sendJson(response, 200, { id, command: `npm start ${id}` });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(uiPath, "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/discover") {
    await handleDiscover(url, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/preset") {
    await handlePreset(request, response);
    return;
  }

  sendJson(response, 404, { error: "Yok" });
}

const port = Number(process.env.PORT ?? 3000);

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      response.end();
    }
  });
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\n  ${port} portu kullanımda. Başka bir port dene:\n` +
        `    PORT=${port + 1} npm run ui\n`,
    );
  } else if (error.code === "EACCES") {
    console.error(`\n  ${port} portuna bağlanma izni yok.\n`);
  } else {
    console.error(`\n  Sunucu başlatılamadı: ${error.message}\n`);
  }

  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log("");
  console.log(`  ${color.bold(color.cyan("Radar"))}  ${color.dim("kaynak keşfi")}`);
  console.log(`  ${color.bold(`http://localhost:${port}`)}`);
  console.log("");
  console.log(color.dim("  Durdurmak için Ctrl+C."));
  console.log("");
});
