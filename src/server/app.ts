import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  ListPagesResponseSchema,
  PublishPageRequestSchema,
} from "../core/contract.js";
import { buildHtmlDocument, renderMarkdownToHtml } from "../core/markdown.js";
import type { PublishService } from "../core/publish-service.js";
import {
  AuthenticationError,
  ContentTooLargeError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  PageNotFoundError,
  RateLimitExceededError,
  ReservedNamespaceError,
  SlugConflictError,
} from "../core/repository.js";

export function createApp(service: PublishService): Hono {
  const app = new Hono();

  app.get("/health", (context) => {
    return context.json({ ok: true });
  });

  let cachedHomepage: string | null = null;
  app.get("/", async (context) => {
    if (!cachedHomepage) {
      const md = `# bul.sh

Publish markdown. Get a URL.

\`\`\`bash
$ pubmd publish report.md
→ https://bul.sh/myname/report
\`\`\`

Works from any terminal. AI agents, scripts, CI — anything that can run a command.

\`\`\`bash
# Install
curl -fsSL https://bul.sh/install | sh

# Claim your namespace
pubmd claim myname

# Publish
pubmd publish notes.md

# Re-publish (same URL updates)
pubmd publish notes.md

# Or just curl it
curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @file.md https://bul.sh/api/namespaces/myname/pages/publish
\`\`\`

---

Open source — [github.com/Restuta/pubmd](https://github.com/Restuta/pubmd)`;
      const rendered = await renderMarkdownToHtml(md);
      cachedHomepage = buildHtmlDocument({
        title: "bul.sh — publish markdown, get a URL",
        description:
          "Publish markdown from the command line to a stable URL. Built for AI agents, usable by humans.",
        noindex: false,
        bodyHtml: rendered.html,
      });
    }
    return context.html(cachedHomepage);
  });

  app.get("/install", (context) => {
    return context.redirect(
      "https://raw.githubusercontent.com/Restuta/pubmd/main/scripts/install.sh",
    );
  });

  app.post("/api/namespaces/:namespace/claim", async (context) => {
    try {
      const ipAddress = requestIp(context);
      const claimed = await service.claimNamespace({
        namespace: context.req.param("namespace"),
        ...(ipAddress === undefined ? {} : { ipAddress }),
      });
      return context.json(claimed, 201);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.post("/api/namespaces/:namespace/pages/publish", async (context) => {
    const token = parseBearerToken(context.req.header("authorization"));
    const contentType = context.req.header("content-type") ?? "";
    const isJson = contentType.includes("application/json");

    try {
      let markdown: string;
      let slug: string | undefined;
      let pageId: string | undefined;
      const ipAddress = requestIp(context);

      if (isJson) {
        const body = PublishPageRequestSchema.parse(await context.req.json());
        markdown = body.markdown;
        slug = body.slug;
        pageId = body.pageId;
      } else {
        markdown = await context.req.text();
        slug = context.req.query("slug") ?? undefined;
        pageId = context.req.query("pageId") ?? undefined;
      }

      const publishInput = {
        namespace: context.req.param("namespace"),
        token,
        markdown,
        origin: requestOrigin(context.req.url),
        ...(ipAddress === undefined ? {} : { ipAddress }),
        ...(pageId === undefined ? {} : { pageId }),
        ...(slug === undefined ? {} : { requestedSlug: slug }),
      };
      const published = await service.publishPage(publishInput);

      return context.json(published, published.created ? 201 : 200);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.get("/api/namespaces/:namespace/pages", async (context) => {
    const token = parseBearerToken(context.req.header("authorization"));

    try {
      const pages = await service.listPages({
        namespace: context.req.param("namespace"),
        origin: requestOrigin(context.req.url),
        token,
      });

      return context.json(ListPagesResponseSchema.parse({ pages }));
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.delete("/api/namespaces/:namespace/pages/:slug", async (context) => {
    const token = parseBearerToken(context.req.header("authorization"));

    try {
      await service.removePage({
        namespace: context.req.param("namespace"),
        slug: context.req.param("slug"),
        token,
      });

      return context.body(null, 204);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.get("/:namespace/:slug", async (context) => {
    try {
      const page = await service.getPublicPage(
        context.req.param("namespace"),
        context.req.param("slug"),
      );

      if (page === null) {
        throw new PageNotFoundError(
          context.req.param("namespace"),
          context.req.param("slug"),
        );
      }

      if (context.req.query("raw") !== undefined) {
        return context.text(await service.readMarkdown(page), 200, {
          "content-type": "text/markdown; charset=utf-8",
        });
      }

      return context.html(await service.readHtml(page), 200, {
        "cache-control": "public, max-age=0, must-revalidate",
        "cdn-cache-control":
          "public, s-maxage=60, stale-while-revalidate=86400",
        "vercel-cdn-cache-control":
          "public, s-maxage=60, stale-while-revalidate=86400",
      });
    } catch (error) {
      throw toHttpException(error);
    }
  });

  return app;
}

function parseBearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token." });
  }

  const token = header.slice("Bearer ".length).trim();

  if (token.length === 0) {
    throw new HTTPException(401, { message: "Missing bearer token." });
  }

  return token;
}

function requestOrigin(url: string): string {
  return new URL(url).origin;
}

function requestIp(context: Context): string | undefined {
  return (
    context.req.header("x-real-ip") ??
    context.req.header("cf-connecting-ip") ??
    undefined
  );
}

function toHttpException(error: unknown): HTTPException {
  if (error instanceof HTTPException) {
    return error;
  }

  if (error instanceof NamespaceExistsError) {
    return new HTTPException(409, { message: error.message });
  }

  if (error instanceof NamespaceNotFoundError) {
    return new HTTPException(404, { message: error.message });
  }

  if (error instanceof AuthenticationError) {
    return new HTTPException(401, { message: error.message });
  }

  if (error instanceof SlugConflictError) {
    return new HTTPException(409, { message: error.message });
  }

  if (error instanceof ReservedNamespaceError) {
    return new HTTPException(409, { message: error.message });
  }

  if (error instanceof RateLimitExceededError) {
    return new HTTPException(429, { message: error.message });
  }

  if (error instanceof ContentTooLargeError) {
    return new HTTPException(413, { message: error.message });
  }

  if (error instanceof PageNotFoundError) {
    return new HTTPException(404, { message: error.message });
  }

  if (error instanceof Error) {
    return new HTTPException(400, { message: error.message });
  }

  return new HTTPException(500, { message: "Unexpected server error." });
}
