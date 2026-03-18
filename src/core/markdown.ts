import matter from "gray-matter";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import {
  type DocumentFrontmatter,
  FrontmatterSchema,
  type Visibility,
} from "./contract.js";

export interface ParsedMarkdownDocument {
  body: string;
  title: string;
  description: string;
  frontmatter: DocumentFrontmatter;
  draft: boolean;
  noindex: boolean;
  visibility: Visibility;
}

export interface RenderedPageDocument {
  html: string;
  renderedMarkdown: string;
}

export function parseMarkdownDocument(
  markdown: string,
): ParsedMarkdownDocument {
  const parsed = matter(markdown);
  const frontmatter = FrontmatterSchema.parse(parsed.data);
  const body = parsed.content.trim();
  const title = frontmatter.title ?? extractTitle(body) ?? "Untitled";
  const description = frontmatter.description ?? extractDescription(body);

  return {
    body,
    title,
    description,
    frontmatter,
    draft: frontmatter.draft ?? false,
    noindex: frontmatter.noindex ?? true,
    visibility: frontmatter.visibility ?? "unlisted",
  };
}

export async function renderMarkdownToHtml(
  markdown: string,
): Promise<RenderedPageDocument> {
  const renderedMarkdown = markdown.trim();
  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSanitize)
      .use(rehypeHighlight)
      .use(rehypeStringify)
      .process(renderedMarkdown),
  );

  return {
    html,
    renderedMarkdown,
  };
}

export function buildHtmlDocument(input: {
  title: string;
  description: string;
  noindex: boolean;
  bodyHtml: string;
}): string {
  const robots = input.noindex ? "noindex,nofollow" : "index,follow";
  const favicon = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111111"/><path fill="#ffffff" d="M18 18h10c11 0 18 6 18 16 0 10-7 16-18 16H18zm10 24c7 0 11-3.5 11-8s-4-8-11-8h-3v16z"/></svg>`,
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
    <meta name="description" content="${escapeHtml(input.description)}">
    <meta property="og:title" content="${escapeHtml(input.title)}">
    <meta property="og:description" content="${escapeHtml(input.description)}">
    <meta name="robots" content="${robots}">
    <link rel="icon" href="data:image/svg+xml,${favicon}">
    <style>
      :root {
        color-scheme: light dark;
        --bg: #ffffff;
        --fg: #111111;
        --muted: #555555;
        --border: #e5e5e5;
        --surface: #f7f7f7;
        --code-bg: #f3f3f3;
        --link: #1d4ed8;
        --link-highlight: rgba(29, 78, 216, 0.16);
        --link-highlight-hover: rgba(29, 78, 216, 0.24);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f0f10;
          --fg: #f5f5f5;
          --muted: #a0a0a0;
          --border: #2c2c2f;
          --surface: #161618;
          --code-bg: #1d1d21;
          --link: #8ab4ff;
          --link-highlight: rgba(138, 180, 255, 0.18);
          --link-highlight-hover: rgba(138, 180, 255, 0.28);
        }
      }

      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.65;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }
      article > :first-child { margin-top: 0; }
      article img { max-width: 100%; height: auto; display: block; }
      p, li { font-size: 1.05rem; }
      h1, h2, h3, h4 { line-height: 1.2; margin-top: 2rem; margin-bottom: 0.85rem; }
      h1 { font-size: 2.3rem; }
      h2 { font-size: 1.75rem; }
      h3 { font-size: 1.35rem; }
      h4 { font-size: 1.1rem; }
      p, ul, ol, pre, blockquote, table { margin: 1rem 0; }
      a {
        color: var(--link);
        text-decoration: none;
        box-shadow: inset 0 -0.35em 0 var(--link-highlight);
        transition: box-shadow 140ms ease, color 140ms ease;
      }
      a:hover,
      a:focus-visible {
        box-shadow: inset 0 -0.5em 0 var(--link-highlight-hover);
      }
      blockquote {
        margin-left: 0;
        padding-left: 1rem;
        border-left: 3px solid var(--border);
        color: var(--muted);
      }
      pre, code {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      }
      pre {
        overflow-x: auto;
        padding: 1rem;
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
      }
      code {
        background: var(--surface);
        padding: 0.15rem 0.35rem;
        border-radius: 6px;
      }
      pre code {
        background: transparent;
        padding: 0;
        border-radius: 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid var(--border);
        padding: 0.6rem;
        text-align: left;
      }
      .hljs-keyword { color: #9d4edd; }
      .hljs-string { color: #198754; }
      .hljs-number { color: #c2410c; }
      .hljs-comment { color: var(--muted); }
      .hljs-title, .hljs-function { color: #2563eb; }
      .hljs-literal { color: #dc2626; }
    </style>
  </head>
  <body>
    <main>
      <article>
        ${input.bodyHtml}
      </article>
    </main>
  </body>
</html>`;
}

function extractTitle(body: string): string | null {
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    if (line.startsWith("#")) {
      return line.replace(/^#+\s*/, "").trim() || null;
    }

    return line.slice(0, 80);
  }

  return null;
}

function extractDescription(body: string): string {
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();

    if (
      line.length === 0 ||
      line.startsWith("#") ||
      line.startsWith("```") ||
      line.startsWith(">") ||
      line.startsWith("|")
    ) {
      continue;
    }

    return line.slice(0, 160);
  }

  return "Published with Publish It.";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
