import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";

import { createFileStore } from "../../src/core/file-store.js";
import { createPublishService } from "../../src/core/publish-service.js";
import { createApp } from "../../src/server/app.js";

export interface StartedTestServer {
  close(): Promise<void>;
  dataDir: string;
  origin: string;
}

export async function startTestServer(
  rootDir: string,
): Promise<StartedTestServer> {
  const dataDir = path.join(rootDir, "data");
  const repository = createFileStore(dataDir);
  const service = createPublishService(repository);
  const app = createApp(service);
  const server = createServer(async (request, response) => {
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const origin = `http://127.0.0.1:${port}`;
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
    const webResponse = await app.fetch(webRequest);

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

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to start test server.");
  }

  return {
    dataDir,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await closeServer(server);
    },
  };
}

async function readNodeRequest(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
