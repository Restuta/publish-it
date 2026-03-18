import { createServer, type IncomingMessage } from "node:http";

import { createConfiguredApp } from "./configured-app.js";

const port = Number(getEnv("PORT") ?? "8787");
const app = createConfiguredApp();

startServer(app.fetch, port);

function startServer(fetchHandler: typeof app.fetch, listenPort: number): void {
  const server = createServer(async (request, response) => {
    const origin = `http://${request.headers.host ?? `127.0.0.1:${listenPort}`}`;
    const url = new URL(request.url ?? "/", origin);
    const headers = new Headers();

    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item);
        }
      } else {
        headers.set(key, value);
      }
    }

    const method = request.method ?? "GET";
    const bodyBuffer = await readNodeRequest(request);
    const webRequest = new Request(url, {
      method,
      headers,
      ...(bodyBuffer.length > 0 ? { body: new Uint8Array(bodyBuffer) } : {}),
    });
    const webResponse = await fetchHandler(webRequest);

    response.statusCode = webResponse.status;

    for (const [key, value] of webResponse.headers) {
      response.setHeader(key, value);
    }

    if (webResponse.body === null) {
      response.end();
      return;
    }

    const reader = webResponse.body.getReader();

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      response.write(Buffer.from(chunk.value));
    }

    response.end();
  });

  server.listen(listenPort, "127.0.0.1", () => {
    console.log(
      `Publish It server listening on http://127.0.0.1:${listenPort}`,
    );
  });
}

function getEnv(name: "PORT"): string | undefined {
  return process.env[name];
}

async function readNodeRequest(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
