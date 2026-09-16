import type { ServerResponse } from "node:http";

/**
 * Server-Sent Events. Keşif dakikalarca sürüyor ve ne yaptığını görmeden
 * beklemek kötü; WebSocket'e gerek yok, akış tek yönlü.
 */
export type EventSink = {
  send(event: string, data: unknown): void;
  close(): void;
  readonly closed: boolean;
};

export function openStream(response: ServerResponse): EventSink {
  let closed = false;

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Bazı vekil sunucular tamponluyor; bu başlık onu kapatıyor.
    "X-Accel-Buffering": "no",
  });

  // Tarayıcı sekmesi kapanırsa yazmayı bırak.
  response.on("close", () => {
    closed = true;
  });

  return {
    get closed() {
      return closed;
    },
    send(event, data) {
      if (closed) {
        return;
      }

      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (!closed) {
        closed = true;
        response.end();
      }
    },
  };
}
