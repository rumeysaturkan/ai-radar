import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverSources, finalizePreset } from "../discovery/run.js";
import type { DiscoveryOutcome } from "../discovery/run.js";
import type { DiscoveryRequest, RankedFeed } from "../discovery/types.js";
import { resolveLang, ui, uiLang } from "../i18n.js";
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
      throw new Error(
        ui({ tr: "İstek gövdesi çok büyük", en: "The request body is too large" }),
      );
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
    sendJson(response, 400, {
      error: ui({ tr: "Konu boş olamaz.", en: "The topic cannot be empty." }),
    });
    return;
  }

  const request: DiscoveryRequest = {
    topic,
    language: resolveLang(url.searchParams.get("lang") ?? uiLang()),
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
      stream.send(
        "failed",
        ui({
          tr: "Bu konuda doğrulanabilen kaynak bulunamadı.",
          en: "No verifiable source was found for this topic.",
        }),
      );
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
      error: ui({
        tr: "Bu keşif oturumu artık yok. Yeniden çalıştır.",
        en: "That discovery session is gone. Run it again.",
      }),
    });
    return;
  }

  const selected = (body.selected ?? [])
    .map((index) => session.outcome.ranked[index])
    .filter((feed): feed is RankedFeed => feed !== undefined);

  if (selected.length === 0) {
    sendJson(response, 400, {
      error: ui({
        tr: "En az bir kaynak seç.",
        en: "Pick at least one source.",
      }),
    });
    return;
  }

  const id = await finalizePreset(session.request, selected, {
    assumeYes: true,
    force: true,
    ...(body.id ? { id: body.id } : {}),
  });

  if (!id) {
    sendJson(response, 500, {
      error: ui({
        tr: "Preset üretilemedi.",
        en: "The preset could not be produced.",
      }),
    });
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

  sendJson(response, 404, { error: ui({ tr: "Yok", en: "Not found" }) });
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
      ui(
        {
          tr: "\n  {port} portu kullanımda. Başka bir port dene:\n    PORT={next} npm run ui\n",
          en: "\n  Port {port} is in use. Try another one:\n    PORT={next} npm run ui\n",
        },
        { port, next: port + 1 },
      ),
    );
  } else if (error.code === "EACCES") {
    console.error(
      ui(
        {
          tr: "\n  {port} portuna bağlanma izni yok.\n",
          en: "\n  No permission to bind to port {port}.\n",
        },
        { port },
      ),
    );
  } else {
    console.error(
      ui(
        {
          tr: "\n  Sunucu başlatılamadı: {reason}\n",
          en: "\n  The server could not start: {reason}\n",
        },
        { reason: error.message },
      ),
    );
  }

  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log("");
  console.log(
    `  ${color.bold(color.cyan("Radar"))}  ` +
      color.dim(ui({ tr: "kaynak keşfi", en: "source discovery" })),
  );
  console.log(`  ${color.bold(`http://localhost:${port}`)}`);
  console.log("");
  console.log(
    color.dim(ui({ tr: "  Durdurmak için Ctrl+C.", en: "  Ctrl+C to stop." })),
  );
  console.log("");
});
