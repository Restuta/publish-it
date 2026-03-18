import { del, get, put } from "@vercel/blob";

import { z } from "zod";

import {
  type NamespaceRecord,
  NamespaceRecordSchema,
  type StoredPage,
  StoredPageSchema,
} from "./contract.js";
import {
  type FilePayload,
  PageNotFoundError,
  type PublishRepository,
} from "./repository.js";

const LookupRecordSchema = z.object({
  pageId: z.string().uuid(),
});

const NamespacePageIndexSchema = z.object({
  pages: z.array(StoredPageSchema),
});

export class BlobStore implements PublishRepository {
  constructor(private readonly token: string) {}

  async claimNamespace(namespace: string, tokenHash: string): Promise<void> {
    const record: NamespaceRecord = {
      namespace,
      tokenHash,
      createdAt: new Date().toISOString(),
    };

    await this.writeJsonBlob(this.namespacePath(namespace), record, false);
  }

  async getNamespace(namespace: string): Promise<NamespaceRecord | null> {
    return this.readJsonBlob(
      this.namespacePath(namespace),
      NamespaceRecordSchema,
    );
  }

  async touchNamespace(
    namespace: string,
    lastPublishAt: string,
  ): Promise<void> {
    const current = await this.getNamespace(namespace);

    if (current === null) {
      throw new Error("NAMESPACE_NOT_FOUND");
    }

    await this.writeJsonBlob(this.namespacePath(namespace), {
      ...current,
      lastPublishAt,
    });
  }

  async listPages(namespace: string): Promise<StoredPage[]> {
    const index = await this.readJsonBlob(
      this.namespaceIndexPath(namespace),
      NamespacePageIndexSchema,
    );
    const pages = index?.pages ?? [];
    return pages
      .filter((page) => page.namespace === namespace)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async findPageById(pageId: string): Promise<StoredPage | null> {
    return this.readJsonBlob(this.pagePath(pageId), StoredPageSchema);
  }

  async findPageBySlug(
    namespace: string,
    slug: string,
  ): Promise<StoredPage | null> {
    const lookup = await this.readJsonBlob(
      this.lookupPath(namespace, slug),
      LookupRecordSchema,
    );

    if (lookup === null) {
      return null;
    }

    return this.findPageById(lookup.pageId);
  }

  async savePage(
    page: StoredPage,
    markdown: FilePayload,
    html: FilePayload,
  ): Promise<void> {
    const previousPage = await this.findPageById(page.pageId);

    await put(markdown.key, markdown.content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: this.token,
    });
    await put(html.key, html.content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: this.token,
    });
    await this.writeJsonBlob(this.pagePath(page.pageId), page);
    await this.writeJsonBlob(this.lookupPath(page.namespace, page.slug), {
      pageId: page.pageId,
    });
    await this.writeNamespaceIndex(page.namespace, page);

    if (previousPage !== null && previousPage.slug !== page.slug) {
      await del(this.lookupPath(previousPage.namespace, previousPage.slug), {
        token: this.token,
      });
    }
  }

  async deletePage(page: StoredPage): Promise<void> {
    if ((await this.findPageById(page.pageId)) === null) {
      throw new PageNotFoundError(page.namespace, page.slug);
    }

    await del(
      [
        this.pagePath(page.pageId),
        this.lookupPath(page.namespace, page.slug),
        page.markdownBlobKey,
        page.htmlBlobKey,
      ],
      {
        token: this.token,
      },
    );
    await this.removeFromNamespaceIndex(page.namespace, page.pageId);
  }

  async readMarkdown(key: string): Promise<string> {
    return this.readTextBlob(key);
  }

  async readHtml(key: string): Promise<string> {
    return this.readTextBlob(key);
  }

  private async readTextBlob(pathname: string): Promise<string> {
    const result = await get(pathname, {
      access: "private",
      token: this.token,
      useCache: false,
    });

    if (result === null || result.statusCode !== 200) {
      throw new Error(`Blob not found: ${pathname}`);
    }

    return streamToString(result.stream);
  }

  private async readJsonBlob<T>(
    pathname: string,
    schema: { parse(input: unknown): T },
  ): Promise<T | null> {
    const result = await get(pathname, {
      access: "private",
      token: this.token,
      useCache: false,
    });

    if (result === null || result.statusCode !== 200) {
      return null;
    }

    return schema.parse(
      JSON.parse(await streamToString(result.stream)) as unknown,
    );
  }

  private async writeJsonBlob(
    pathname: string,
    value: unknown,
    allowOverwrite = true,
  ): Promise<void> {
    await put(pathname, stringifyJson(value), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite,
      token: this.token,
    });
  }

  private namespacePath(namespace: string): string {
    return `namespaces/${namespace}.json`;
  }

  private namespaceIndexPath(namespace: string): string {
    return `indexes/${namespace}.json`;
  }

  private pagePath(pageId: string): string {
    return `pages/${pageId}.json`;
  }

  private lookupPath(namespace: string, slug: string): string {
    return `lookups/${namespace}/${slug}.json`;
  }

  private async writeNamespaceIndex(
    namespace: string,
    page: StoredPage,
  ): Promise<void> {
    const current = await this.readJsonBlob(
      this.namespaceIndexPath(namespace),
      NamespacePageIndexSchema,
    );
    const nextPages = [...(current?.pages ?? [])];
    const existingIndex = nextPages.findIndex(
      (currentPage) => currentPage.pageId === page.pageId,
    );

    if (existingIndex === -1) {
      nextPages.push(page);
    } else {
      nextPages[existingIndex] = page;
    }

    await this.writeJsonBlob(this.namespaceIndexPath(namespace), {
      pages: nextPages,
    });
  }

  private async removeFromNamespaceIndex(
    namespace: string,
    pageId: string,
  ): Promise<void> {
    const current = await this.readJsonBlob(
      this.namespaceIndexPath(namespace),
      NamespacePageIndexSchema,
    );

    if (current === null) {
      return;
    }

    await this.writeJsonBlob(this.namespaceIndexPath(namespace), {
      pages: current.pages.filter((page) => page.pageId !== pageId),
    });
  }
}

async function streamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    chunks.push(chunk.value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
