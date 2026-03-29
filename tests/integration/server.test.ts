import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type StartedTestServer, startTestServer } from "./test-server.js";

describe("server integration", () => {
  let server: StartedTestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("claims namespaces, publishes pages, serves html and raw markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-server-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/claim`,
      { method: "POST" },
    );
    expect(claimResponse.status).toBe(201);
    const claimed = (await claimResponse.json()) as { token: string };
    const publishResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: `---
title: Launch Post
description: Short launch note
noindex: false
---

# Hello

This is the body.`,
        }),
      },
    );

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as {
      created: boolean;
      noOp: boolean;
      pageId: string;
      slug: string;
      updated: boolean;
      url: string;
    };
    expect(published.slug).toBe("launch-post");
    expect(published.created).toBe(true);
    expect(published.updated).toBe(false);
    expect(published.noOp).toBe(false);

    const noOpResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: `---
title: Launch Post
description: Short launch note
noindex: false
---

# Hello

This is the body.`,
        }),
      },
    );
    expect(noOpResponse.status).toBe(200);
    const noOpPublished = (await noOpResponse.json()) as {
      created: boolean;
      noOp: boolean;
      updated: boolean;
      url: string;
    };
    expect(noOpPublished.url).toBe(published.url);
    expect(noOpPublished.created).toBe(false);
    expect(noOpPublished.updated).toBe(false);
    expect(noOpPublished.noOp).toBe(true);

    const htmlResponse = await fetch(published.url);
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(htmlResponse.headers.get("cdn-cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=86400",
    );
    expect(htmlResponse.headers.get("vercel-cdn-cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=86400",
    );
    expect(html).toContain("<title>Launch Post</title>");
    expect(html).toContain("This is the body.");

    const rawResponse = await fetch(`${published.url}?raw=1`);
    expect(rawResponse.status).toBe(200);
    expect(await rawResponse.text()).toContain("This is the body.");

    const listResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages`,
      {
        headers: {
          authorization: `Bearer ${claimed.token}`,
        },
      },
    );
    const listed = (await listResponse.json()) as {
      pages: Array<{ slug: string; url: string }>;
    };
    expect(listed.pages).toHaveLength(1);
    expect(listed.pages[0]?.slug).toBe("launch-post");
  });

  it("rejects reserved namespaces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    const response = await fetch(`${server.origin}/api/namespaces/api/claim`, {
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("reserved");
  });

  it("rate limits repeated namespace claims from the same ip", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    for (const namespace of ["one", "two", "three"]) {
      const response = await fetch(
        `${server.origin}/api/namespaces/${namespace}/claim`,
        {
          method: "POST",
          headers: {
            "x-real-ip": "203.0.113.10",
          },
        },
      );
      expect(response.status).toBe(201);
    }

    const limited = await fetch(`${server.origin}/api/namespaces/four/claim`, {
      method: "POST",
      headers: {
        "x-real-ip": "203.0.113.10",
      },
    });

    expect(limited.status).toBe(429);
  });

  it("reclaims an old empty namespace when it is claimed again", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    const firstClaim = await fetch(
      `${server.origin}/api/namespaces/reclaim-me/claim`,
      {
        method: "POST",
      },
    );
    expect(firstClaim.status).toBe(201);

    const namespacePath = path.join(
      server.dataDir,
      "namespaces",
      "reclaim-me.json",
    );
    const currentRecord = JSON.parse(await readFile(namespacePath, "utf8")) as {
      createdAt: string;
      namespace: string;
      tokenHash: string;
    };
    currentRecord.createdAt = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await writeFile(
      namespacePath,
      `${JSON.stringify(currentRecord, null, 2)}\n`,
    );

    const secondClaim = await fetch(
      `${server.origin}/api/namespaces/reclaim-me/claim`,
      {
        method: "POST",
        headers: {
          "x-real-ip": "198.51.100.5",
        },
      },
    );

    expect(secondClaim.status).toBe(201);
  });

  it("rejects markdown bodies above the size cap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/size-test/claim`,
      {
        method: "POST",
      },
    );
    const claimed = (await claimResponse.json()) as { token: string };
    const oversizedMarkdown = `# big\n\n${"a".repeat(300 * 1024)}`;

    const publishResponse = await fetch(
      `${server.origin}/api/namespaces/size-test/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: oversizedMarkdown,
        }),
      },
    );

    expect(publishResponse.status).toBe(413);
  });

  it("rate limits excessive publishes on the same namespace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/publish-limit/claim`,
      {
        method: "POST",
      },
    );
    const claimed = (await claimResponse.json()) as { token: string };

    for (let index = 0; index < 30; index += 1) {
      const response = await fetch(
        `${server.origin}/api/namespaces/publish-limit/pages/publish`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claimed.token}`,
            "content-type": "application/json",
            "x-real-ip": "203.0.113.10",
          },
          body: JSON.stringify({
            markdown: "# Publish limit\n\nsame body",
            slug: "same-page",
          }),
        },
      );
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
    }

    const limited = await fetch(
      `${server.origin}/api/namespaces/publish-limit/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
          "x-real-ip": "203.0.113.10",
        },
        body: JSON.stringify({
          markdown: "# Publish limit\n\nsame body",
          slug: "same-page",
        }),
      },
    );

    expect(limited.status).toBe(429);
  });

  it("rejects publish attempts with the wrong token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/auth-test/claim`,
      {
        method: "POST",
      },
    );
    expect(claimResponse.status).toBe(201);

    const response = await fetch(
      `${server.origin}/api/namespaces/auth-test/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: "# nope",
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects slug conflicts when republishing a different page into an occupied slug", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-server-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/conflict-test/claim`,
      {
        method: "POST",
      },
    );
    const claimed = (await claimResponse.json()) as { token: string };

    const pageOneResponse = await fetch(
      `${server.origin}/api/namespaces/conflict-test/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: "# page one",
          slug: "page-one",
        }),
      },
    );
    const pageOne = (await pageOneResponse.json()) as { pageId: string };

    const pageTwoResponse = await fetch(
      `${server.origin}/api/namespaces/conflict-test/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: "# page two",
          slug: "page-two",
        }),
      },
    );
    expect(pageTwoResponse.status).toBe(201);

    const conflictingUpdate = await fetch(
      `${server.origin}/api/namespaces/conflict-test/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: "# page one updated",
          pageId: pageOne.pageId,
          slug: "page-two",
        }),
      },
    );

    expect(conflictingUpdate.status).toBe(409);
  });
});
