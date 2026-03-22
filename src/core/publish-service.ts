import { randomUUID } from "node:crypto";

import type {
  ClaimNamespaceResponse,
  NamespaceRecord,
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
  ContentTooLargeError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  PageNotFoundError,
  type PublishRepository,
  RateLimitExceededError,
  type RateLimitRecord,
  ReservedNamespaceError,
  SlugConflictError,
} from "./repository.js";
import { ensureName, slugify } from "./slug.js";

const DEFAULT_RESERVED_NAMESPACES = new Set([
  "admin",
  "api",
  "www",
  "support",
  "help",
  "install",
  "bul",
  "pubmd",
  "root",
]);

export interface PublishPageInput {
  ipAddress?: string;
  markdown: string;
  namespace: string;
  pageId?: string;
  requestedSlug?: string;
  token: string;
  origin: string;
}

export interface ClaimNamespaceInput {
  ipAddress?: string;
  namespace: string;
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

export interface PublishServiceOptions {
  claimDailyLimit: number;
  claimHourlyLimit: number;
  maxMarkdownBytes: number;
  publishIpHourlyLimit: number;
  publishNamespaceTenMinuteLimit: number;
  reclaimUnpublishedNamespaceAfterMs: number;
  reservedNamespaces: Set<string>;
}

export interface PublishService {
  claimNamespace(input: ClaimNamespaceInput): Promise<ClaimNamespaceResponse>;
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
  options: Partial<PublishServiceOptions> = {},
): PublishService {
  const resolvedOptions: PublishServiceOptions = {
    claimDailyLimit: options.claimDailyLimit ?? 10,
    claimHourlyLimit: options.claimHourlyLimit ?? 3,
    maxMarkdownBytes: options.maxMarkdownBytes ?? 256 * 1024,
    publishIpHourlyLimit: options.publishIpHourlyLimit ?? 100,
    publishNamespaceTenMinuteLimit:
      options.publishNamespaceTenMinuteLimit ?? 30,
    reclaimUnpublishedNamespaceAfterMs:
      options.reclaimUnpublishedNamespaceAfterMs ?? 7 * 24 * 60 * 60 * 1000,
    reservedNamespaces:
      options.reservedNamespaces ?? DEFAULT_RESERVED_NAMESPACES,
  };

  async function claimNamespace(
    input: ClaimNamespaceInput,
  ): Promise<ClaimNamespaceResponse> {
    const safeNamespace = ensureName(input.namespace);
    ensureNamespaceAllowed(safeNamespace);
    await enforceClaimLimits(input.ipAddress);

    const existing = await repository.getNamespace(safeNamespace);
    const now = new Date();
    const token = createToken();

    if (
      existing !== null &&
      !isReclaimableNamespace(
        existing,
        now,
        resolvedOptions.reclaimUnpublishedNamespaceAfterMs,
      )
    ) {
      throw new NamespaceExistsError(safeNamespace);
    }

    const namespaceRecord: NamespaceRecord = {
      namespace: safeNamespace,
      tokenHash: sha256(token),
      createdAt: now.toISOString(),
    };

    if (existing === null) {
      await repository.claimNamespace(safeNamespace, namespaceRecord.tokenHash);
    } else {
      await repository.saveNamespace(namespaceRecord);
    }

    return {
      namespace: safeNamespace,
      token,
    };
  }

  async function publishPage(input: PublishPageInput): Promise<PublishedPage> {
    const safeNamespace = ensureName(input.namespace);
    await authenticate(safeNamespace, input.token);
    await enforcePublishLimits(safeNamespace, input.ipAddress);
    ensureMarkdownSize(input.markdown);

    const parsed = parseMarkdownDocument(input.markdown);
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
    const rendered = await renderMarkdownToHtml(parsed.body);
    const htmlDocument = buildHtmlDocument({
      title: parsed.title,
      description: parsed.description,
      noindex: parsed.noindex,
      bodyHtml: rendered.html,
    });
    const contentHash = sha256(
      JSON.stringify({
        markdown: input.markdown,
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

  function ensureNamespaceAllowed(namespace: string): void {
    if (resolvedOptions.reservedNamespaces.has(namespace)) {
      throw new ReservedNamespaceError(namespace);
    }
  }

  function ensureMarkdownSize(markdown: string): void {
    if (
      Buffer.byteLength(markdown, "utf8") > resolvedOptions.maxMarkdownBytes
    ) {
      throw new ContentTooLargeError(resolvedOptions.maxMarkdownBytes);
    }
  }

  async function enforceClaimLimits(ipAddress?: string): Promise<void> {
    const ipKey = normalizeIpAddress(ipAddress);

    if (ipKey === null) {
      return;
    }

    await incrementRateLimit(
      `claim:hour:${hashIdentity(ipKey)}`,
      resolvedOptions.claimHourlyLimit,
      60 * 60 * 1000,
      `Too many namespace claims from this IP. Try again later.`,
    );
    await incrementRateLimit(
      `claim:day:${hashIdentity(ipKey)}`,
      resolvedOptions.claimDailyLimit,
      24 * 60 * 60 * 1000,
      `Too many namespace claims from this IP today.`,
    );
  }

  async function enforcePublishLimits(
    namespace: string,
    ipAddress?: string,
  ): Promise<void> {
    await incrementRateLimit(
      `publish:namespace:${namespace}`,
      resolvedOptions.publishNamespaceTenMinuteLimit,
      10 * 60 * 1000,
      `Too many publishes for namespace "${namespace}".`,
    );

    const ipKey = normalizeIpAddress(ipAddress);

    if (ipKey === null) {
      return;
    }

    await incrementRateLimit(
      `publish:ip:${hashIdentity(ipKey)}`,
      resolvedOptions.publishIpHourlyLimit,
      60 * 60 * 1000,
      `Too many publishes from this IP. Try again later.`,
    );
  }

  async function incrementRateLimit(
    bucket: string,
    maxCount: number,
    windowMs: number,
    message: string,
  ): Promise<void> {
    const now = new Date();
    const current = await repository.getRateLimitRecord(bucket);
    const nextRecord = computeNextRateLimitRecord(current, now, windowMs);

    if (nextRecord.count > maxCount) {
      throw new RateLimitExceededError(message);
    }

    await repository.setRateLimitRecord(bucket, nextRecord);
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

function buildPageUrl(origin: string, namespace: string, slug: string): string {
  return new URL(`/${namespace}/${slug}`, origin).toString();
}

function normalizeIpAddress(ipAddress: string | undefined): string | null {
  if (ipAddress === undefined) {
    return null;
  }

  const trimmed = ipAddress.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hashIdentity(value: string): string {
  return sha256(value).slice(0, 16);
}

function isReclaimableNamespace(
  namespace: NamespaceRecord,
  now: Date,
  reclaimAfterMs: number,
): boolean {
  return (
    namespace.lastPublishAt === undefined &&
    now.getTime() - new Date(namespace.createdAt).getTime() > reclaimAfterMs
  );
}

function computeNextRateLimitRecord(
  current: RateLimitRecord | null,
  now: Date,
  windowMs: number,
): RateLimitRecord {
  if (current === null) {
    return {
      count: 1,
      windowStartedAt: now.toISOString(),
    };
  }

  const windowStart = new Date(current.windowStartedAt).getTime();

  if (now.getTime() - windowStart >= windowMs) {
    return {
      count: 1,
      windowStartedAt: now.toISOString(),
    };
  }

  return {
    count: current.count + 1,
    windowStartedAt: current.windowStartedAt,
  };
}
