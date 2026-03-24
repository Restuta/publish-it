import { randomUUID } from "node:crypto";

import type {
  ClaimNamespaceResponse,
  PublishedPage,
  StoredPage,
} from "./contract.js";
import { constantTimeEqual, createToken, sha256 } from "./hash.js";
import {
  buildHtmlDocument,
  parseMarkdownDocument,
  renderMarkdownToHtml,
} from "./markdown.js";
import {
  AuthenticationError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  PageNotFoundError,
  type PublishRepository,
  SlugConflictError,
} from "./repository.js";
import { ensureName, slugify } from "./slug.js";

export interface PublishPageInput {
  markdown: string;
  renderMarkdown?: string;
  namespace: string;
  pageId?: string;
  requestedSlug?: string;
  token: string;
  origin: string;
}

export interface ListPagesInput {
  namespace: string;
  origin: string;
  token: string;
}

export interface RemovePageInput {
  namespace: string;
  slug: string;
  token: string;
}

export interface PublishService {
  claimNamespace(namespace: string): Promise<ClaimNamespaceResponse>;
  publishPage(input: PublishPageInput): Promise<PublishedPage>;
  listPages(input: ListPagesInput): Promise<
    Array<{
      pageId: string;
      namespace: string;
      slug: string;
      title: string;
      description: string;
      updatedAt: string;
      url: string;
    }>
  >;
  removePage(input: RemovePageInput): Promise<void>;
  getPublicPage(namespace: string, slug: string): Promise<StoredPage | null>;
  readHtml(page: StoredPage): Promise<string>;
  readMarkdown(page: StoredPage): Promise<string>;
}

export function createPublishService(
  repository: PublishRepository,
): PublishService {
  async function claimNamespace(
    namespace: string,
  ): Promise<ClaimNamespaceResponse> {
    const safeNamespace = ensureName(namespace);
    const existing = await repository.getNamespace(safeNamespace);

    if (existing !== null) {
      throw new NamespaceExistsError(safeNamespace);
    }

    const token = createToken();
    await repository.claimNamespace(safeNamespace, sha256(token));

    return {
      namespace: safeNamespace,
      token,
    };
  }

  async function publishPage(input: PublishPageInput): Promise<PublishedPage> {
    const safeNamespace = ensureName(input.namespace);
    await authenticate(safeNamespace, input.token);

    const parsed = parseMarkdownDocument(input.markdown);
    const renderMarkdown = input.renderMarkdown ?? parsed.body;
    const requestedSlug =
      input.requestedSlug ?? parsed.frontmatter.slug ?? slugify(parsed.title);
    const safeSlug = ensureName(slugify(requestedSlug));
    const existingPage = await resolveExistingPage(
      safeNamespace,
      safeSlug,
      input.pageId,
    );
    const pageId = existingPage?.pageId ?? randomUUID();
    const slug = safeSlug;
    const now = new Date().toISOString();
    const markdownBlobKey = `${pageId}.md`;
    const htmlBlobKey = `${pageId}.html`;
    const rendered = await renderMarkdownToHtml(renderMarkdown);
    const htmlDocument = buildHtmlDocument({
      title: parsed.title,
      description: parsed.description,
      noindex: parsed.noindex,
      bodyHtml: rendered.html,
    });
    const contentHash = sha256(
      JSON.stringify({
        markdown: input.markdown,
        renderMarkdown,
        slug,
        title: parsed.title,
        description: parsed.description,
        noindex: parsed.noindex,
        visibility: parsed.visibility,
        draft: parsed.draft,
      }),
    );
    const noOp =
      existingPage !== null &&
      existingPage.contentHash === contentHash &&
      existingPage.slug === slug;

    if (!noOp) {
      const page: StoredPage = {
        pageId,
        namespace: safeNamespace,
        slug,
        title: parsed.title,
        description: parsed.description,
        visibility: parsed.visibility,
        draft: parsed.draft,
        noindex: parsed.noindex,
        contentHash,
        createdAt: existingPage?.createdAt ?? now,
        updatedAt: now,
        markdownBlobKey,
        htmlBlobKey,
      };

      await repository.savePage(
        page,
        {
          content: input.markdown,
          key: markdownBlobKey,
        },
        {
          content: htmlDocument,
          key: htmlBlobKey,
        },
      );

      await repository.touchNamespace(safeNamespace, now);
    }

    return {
      pageId,
      namespace: safeNamespace,
      slug,
      title: parsed.title,
      description: parsed.description,
      url: buildPageUrl(input.origin, safeNamespace, slug),
      created: existingPage === null && !noOp,
      updated: existingPage !== null && !noOp,
      noOp,
    };
  }

  async function listPages(input: ListPagesInput): Promise<
    Array<{
      pageId: string;
      namespace: string;
      slug: string;
      title: string;
      description: string;
      updatedAt: string;
      url: string;
    }>
  > {
    const safeNamespace = ensureName(input.namespace);
    await authenticate(safeNamespace, input.token);

    const pages = await repository.listPages(safeNamespace);
    return pages.map((page) => ({
      pageId: page.pageId,
      namespace: page.namespace,
      slug: page.slug,
      title: page.title,
      description: page.description,
      updatedAt: page.updatedAt,
      url: buildPageUrl(input.origin, page.namespace, page.slug),
    }));
  }

  async function removePage(input: RemovePageInput): Promise<void> {
    const safeNamespace = ensureName(input.namespace);
    const safeSlug = ensureName(input.slug);
    await authenticate(safeNamespace, input.token);

    const page = await repository.findPageBySlug(safeNamespace, safeSlug);

    if (page === null) {
      throw new PageNotFoundError(safeNamespace, safeSlug);
    }

    await repository.deletePage(page);
  }

  async function getPublicPage(
    namespace: string,
    slug: string,
  ): Promise<StoredPage | null> {
    return repository.findPageBySlug(ensureName(namespace), ensureName(slug));
  }

  async function readHtml(page: StoredPage): Promise<string> {
    return repository.readHtml(page.htmlBlobKey);
  }

  async function readMarkdown(page: StoredPage): Promise<string> {
    return repository.readMarkdown(page.markdownBlobKey);
  }

  async function authenticate(namespace: string, token: string): Promise<void> {
    const record = await repository.getNamespace(namespace);

    if (record === null) {
      throw new NamespaceNotFoundError(namespace);
    }

    if (!constantTimeEqual(record.tokenHash, sha256(token))) {
      throw new AuthenticationError();
    }
  }

  function buildPageUrl(
    origin: string,
    namespace: string,
    slug: string,
  ): string {
    return new URL(`/${namespace}/${slug}`, origin).toString();
  }

  async function resolveExistingPage(
    namespace: string,
    slug: string,
    pageId: string | undefined,
  ): Promise<StoredPage | null> {
    if (pageId !== undefined) {
      const byId = await repository.findPageById(pageId);

      if (byId === null) {
        return null;
      }

      if (byId.namespace !== namespace) {
        throw new AuthenticationError();
      }

      const slugOwner = await repository.findPageBySlug(namespace, slug);

      if (slugOwner !== null && slugOwner.pageId !== byId.pageId) {
        throw new SlugConflictError(namespace, slug);
      }

      return byId;
    }

    return repository.findPageBySlug(namespace, slug);
  }

  return {
    claimNamespace,
    getPublicPage,
    listPages,
    publishPage,
    readHtml,
    readMarkdown,
    removePage,
  };
}
