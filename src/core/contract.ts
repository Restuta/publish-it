import { z } from "zod";

export const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const VisibilitySchema = z.enum(["public", "unlisted", "private"]);

export const FrontmatterSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: NameSchema.optional(),
    draft: z.boolean().optional(),
    noindex: z.boolean().optional(),
    visibility: VisibilitySchema.optional(),
    description: z.string().trim().min(1).max(300).optional(),
  })
  .passthrough();

export const ClaimNamespaceResponseSchema = z.object({
  namespace: NameSchema,
  token: z.string().min(1),
});

export const PublishPageRequestSchema = z.object({
  markdown: z.string().min(1),
  renderMarkdown: z.string().min(1).optional(),
  slug: NameSchema.optional(),
  pageId: z.string().uuid().optional(),
});

export const PublishedPageSchema = z.object({
  pageId: z.string().uuid(),
  namespace: NameSchema,
  slug: NameSchema,
  title: z.string().min(1),
  description: z.string(),
  url: z.string().url(),
  created: z.boolean(),
  updated: z.boolean(),
  noOp: z.boolean(),
});

export const StoredPageSchema = z.object({
  pageId: z.string().uuid(),
  namespace: NameSchema,
  slug: NameSchema,
  title: z.string().min(1),
  description: z.string(),
  visibility: VisibilitySchema,
  draft: z.boolean(),
  noindex: z.boolean(),
  contentHash: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  markdownBlobKey: z.string().min(1),
  htmlBlobKey: z.string().min(1),
});

export const NamespaceRecordSchema = z.object({
  namespace: NameSchema,
  tokenHash: z.string().min(1),
  createdAt: z.string().datetime(),
  lastPublishAt: z.string().datetime().optional(),
});

export const ListedPageSchema = z.object({
  pageId: z.string().uuid(),
  namespace: NameSchema,
  slug: NameSchema,
  title: z.string().min(1),
  description: z.string(),
  updatedAt: z.string().datetime(),
  url: z.string().url(),
});

export const ListPagesResponseSchema = z.object({
  pages: z.array(ListedPageSchema),
});

export type ClaimNamespaceResponse = z.infer<
  typeof ClaimNamespaceResponseSchema
>;
export type DocumentFrontmatter = z.infer<typeof FrontmatterSchema>;
export type ListPagesResponse = z.infer<typeof ListPagesResponseSchema>;
export type NamespaceRecord = z.infer<typeof NamespaceRecordSchema>;
export type PublishedPage = z.infer<typeof PublishedPageSchema>;
export type PublishPageRequest = z.infer<typeof PublishPageRequestSchema>;
export type StoredPage = z.infer<typeof StoredPageSchema>;
export type Visibility = z.infer<typeof VisibilitySchema>;
