import { beforeEach, describe, expect, it, vi } from "vitest";

const blobState = vi.hoisted(() => {
  return {
    stores: new Map<string, Map<string, string>>(),
  };
});

vi.mock("@vercel/blob", () => {
  function getStore(token: string): Map<string, string> {
    let store = blobState.stores.get(token);

    if (store === undefined) {
      store = new Map<string, string>();
      blobState.stores.set(token, store);
    }

    return store;
  }

  return {
    del: vi.fn(
      async (target: string | string[], options: { token: string }) => {
        const store = getStore(options.token);
        const pathnames = Array.isArray(target) ? target : [target];

        for (const pathname of pathnames) {
          store.delete(pathname);
        }
      },
    ),
    get: vi.fn(async (pathname: string, options: { token: string }) => {
      const store = getStore(options.token);
      const value = store.get(pathname);

      if (value === undefined) {
        return null;
      }

      const body = new Response(value).body;

      if (body === null) {
        throw new Error("Response body was unexpectedly null.");
      }

      return {
        statusCode: 200 as const,
        stream: body,
      };
    }),
    list: vi.fn(async (options: { prefix?: string; token: string }) => {
      const store = getStore(options.token);
      const prefix = options.prefix ?? "";
      const blobs = [...store.keys()]
        .filter((pathname) => pathname.startsWith(prefix))
        .map((pathname) => ({ pathname }));

      return {
        blobs,
        hasMore: false,
      };
    }),
    put: vi.fn(
      async (
        pathname: string,
        body: string,
        options: { allowOverwrite?: boolean; token: string },
      ) => {
        const store = getStore(options.token);

        if (options.allowOverwrite === false && store.has(pathname)) {
          throw new Error("already exists");
        }

        store.set(pathname, body);
        return {
          pathname,
          url: `https://blob.example/${pathname}`,
        };
      },
    ),
  };
});

import { createBlobStore } from "../../src/core/blob-store.js";
import type { StoredPage } from "../../src/core/contract.js";

describe("createBlobStore", () => {
  const contentToken = "content-token";
  const metadataToken = "metadata-token";

  beforeEach(() => {
    blobState.stores.clear();
  });

  it("claims and updates namespaces in metadata storage", async () => {
    const store = createBlobStore(contentToken, metadataToken);

    await store.claimNamespace("demo", "hash-1");
    await store.touchNamespace("demo", "2026-03-19T00:00:00.000Z");

    const namespace = await store.getNamespace("demo");
    expect(namespace).toMatchObject({
      namespace: "demo",
      tokenHash: "hash-1",
      lastPublishAt: "2026-03-19T00:00:00.000Z",
    });
  });

  it("stores content publicly and metadata privately", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const page = makePage({
      createdAt: "2026-03-19T00:00:00.000Z",
      description: "Demo description",
      pageId: "11111111-1111-4111-8111-111111111111",
      slug: "demo-page",
      title: "Demo Page",
      updatedAt: "2026-03-19T00:00:00.000Z",
    });

    await store.savePage(
      page,
      { content: "# demo", key: page.markdownBlobKey },
      { content: "<h1>demo</h1>", key: page.htmlBlobKey },
    );

    expect(await store.readMarkdown(page.markdownBlobKey)).toBe("# demo");
    expect(await store.readHtml(page.htmlBlobKey)).toBe("<h1>demo</h1>");
    expect(await store.findPageById(page.pageId)).toMatchObject({
      slug: "demo-page",
      title: "Demo Page",
    });
    expect(await store.findPageBySlug("demo", "demo-page")).toMatchObject({
      pageId: page.pageId,
    });
    expect(await store.listPages("demo")).toHaveLength(1);
  });

  it("updates slug lookups when a page is renamed", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const original = makePage({
      pageId: "22222222-2222-4222-8222-222222222222",
      slug: "old-slug",
      title: "Old",
      updatedAt: "2026-03-19T00:00:00.000Z",
    });
    const renamed = makePage({
      pageId: original.pageId,
      slug: "new-slug",
      title: "New",
      updatedAt: "2026-03-19T00:05:00.000Z",
    });

    await store.savePage(
      original,
      { content: "# old", key: original.markdownBlobKey },
      { content: "<h1>old</h1>", key: original.htmlBlobKey },
    );
    await store.savePage(
      renamed,
      { content: "# new", key: renamed.markdownBlobKey },
      { content: "<h1>new</h1>", key: renamed.htmlBlobKey },
    );

    expect(await store.findPageBySlug("demo", "old-slug")).toBeNull();
    expect(await store.findPageBySlug("demo", "new-slug")).toMatchObject({
      pageId: renamed.pageId,
      slug: "new-slug",
    });
  });

  it("removes metadata lookups, index entries, and content blobs on delete", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const page = makePage({
      pageId: "33333333-3333-4333-8333-333333333333",
      slug: "delete-me",
      title: "Delete Me",
    });

    await store.savePage(
      page,
      { content: "# delete", key: page.markdownBlobKey },
      { content: "<h1>delete</h1>", key: page.htmlBlobKey },
    );

    await store.deletePage(page);

    expect(await store.findPageById(page.pageId)).toBeNull();
    expect(await store.findPageBySlug("demo", "delete-me")).toBeNull();
    expect(await store.listPages("demo")).toEqual([]);
    await expect(store.readHtml(page.htmlBlobKey)).rejects.toThrow(
      "Blob not found",
    );
  });
});

function makePage(overrides: Partial<StoredPage>): StoredPage {
  return {
    pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    namespace: "demo",
    slug: "page",
    title: "Page",
    description: "Description",
    visibility: "unlisted",
    draft: false,
    noindex: true,
    contentHash: "hash",
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    markdownBlobKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md",
    htmlBlobKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.html",
    ...overrides,
  };
}
