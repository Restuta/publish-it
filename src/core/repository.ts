import type { NamespaceRecord, StoredPage } from "./contract.js";

export class NamespaceExistsError extends Error {
  constructor(namespace: string) {
    super(`Namespace "${namespace}" is already claimed.`);
  }
}

export class NamespaceNotFoundError extends Error {
  constructor(namespace: string) {
    super(`Namespace "${namespace}" was not found.`);
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication failed.");
  }
}

export class PageNotFoundError extends Error {
  constructor(namespace: string, slug: string) {
    super(`Page "${namespace}/${slug}" was not found.`);
  }
}

export class SlugConflictError extends Error {
  constructor(namespace: string, slug: string) {
    super(`Slug "${namespace}/${slug}" is already in use.`);
  }
}

export class ReservedNamespaceError extends Error {
  constructor(namespace: string) {
    super(`Namespace "${namespace}" is reserved.`);
  }
}

export class RateLimitExceededError extends Error {}

export class ContentTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Markdown exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
}

export interface RateLimitRecord {
  count: number;
  windowStartedAt: string;
}

export interface FilePayload {
  content: string;
  key: string;
}

export interface PublishRepository {
  claimNamespace(namespace: string, tokenHash: string): Promise<void>;
  saveNamespace(record: NamespaceRecord): Promise<void>;
  getNamespace(namespace: string): Promise<NamespaceRecord | null>;
  touchNamespace(namespace: string, lastPublishAt: string): Promise<void>;
  getRateLimitRecord(bucket: string): Promise<RateLimitRecord | null>;
  setRateLimitRecord(bucket: string, record: RateLimitRecord): Promise<void>;
  listPages(namespace: string): Promise<StoredPage[]>;
  findPageById(pageId: string): Promise<StoredPage | null>;
  findPageBySlug(namespace: string, slug: string): Promise<StoredPage | null>;
  savePage(
    page: StoredPage,
    markdown: FilePayload,
    html: FilePayload,
  ): Promise<void>;
  /** Caller must verify the page exists before calling. Deletes are best-effort — no error on missing data. */
  deletePage(page: StoredPage): Promise<void>;
  readMarkdown(key: string): Promise<string>;
  readHtml(key: string): Promise<string>;
}
