import type { ServerResponse } from "node:http";

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
    "X-Accel-Buffering": "no",
  });

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
