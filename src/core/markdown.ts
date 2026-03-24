import matter from "gray-matter";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
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
  const renderedMarkdown = autolinkBareUrls(stripWikilinks(markdown.trim()));
  const defaultProtocols = defaultSchema.protocols as
    | Record<string, Array<string> | null | undefined>
    | undefined;
  const defaultSrcProtocolsValue = defaultProtocols?.["src"];
  const defaultSrcProtocols = Array.isArray(defaultSrcProtocolsValue)
    ? defaultSrcProtocolsValue
    : [];
  const sanitizeSchema = {
    ...defaultSchema,
    protocols: {
      ...defaultSchema.protocols,
      src: [...defaultSrcProtocols, "data"],
    },
  };
  const rawHtml = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSanitize, sanitizeSchema)
      .use(rehypeHighlight)
      .use(rehypeStringify)
      .process(renderedMarkdown),
  );

  const html = convertHighlights(rawHtml);

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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M24 12v40M40 12v40M12 24h40M12 40h40" stroke="#998a78" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`,
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
        /* Golden ratio (φ) typographic system
           --ratio: the base proportion (φ = 1.618)
           --scale: √ratio — the step between heading levels (change both together)
           Spacing: powers of ratio → 0.382  0.618  1  1.618  2.618
           Type:    powers of scale → 1.272  1.618  2.058  2.618  */
        --ratio: 1.618;
        --scale: 1.45;  /* between φ^(2/3) and φ — punchy hierarchy */
        --r1: var(--ratio);                        /* φ¹ = 1.618 */
        --r2: calc(var(--ratio) * var(--ratio));   /* φ² = 2.618 */
        --r-1: calc(1 / var(--ratio));             /* φ⁻¹ = 0.618 */
        --r-2: calc(1 / var(--r2));                /* φ⁻² = 0.382 */
        --s1: var(--scale);                        /* √φ¹ = 1.272 (H4) */
        --s2: calc(var(--scale) * var(--scale));   /* √φ² = 1.618 (H3) */
        --s3: calc(var(--s2) * var(--scale));      /* √φ³ = 2.058 (H2) */
        --s4: calc(var(--s3) * var(--scale));      /* √φ⁴ = 2.618 (H1) */
        /* Colors */
        --bg: #faf9f7;
        --fg: #2a2a28;
        --fg-heading: #1a1a18;
        --muted: #6b6b6b;
        --border: #e0ddd8;
        --surface: #f0eee9;
        --code-bg: #f2f1ee;
        --code-border: #e0ddd8;
        --link: #2d5da1;
        --link-hover: #1a4178;
        --accent: #c7402d;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #141312;
          --fg: #e8e4df;
          --fg-heading: #f5f2ed;
          --muted: #918d86;
          --border: #2e2c28;
          --surface: #1c1b19;
          --code-bg: #232220;
          --code-border: #2e2c28;
          --link: #7aaddf;
          --link-hover: #a4c8ec;
          --accent: #e05a47;
          --quote-border: #e05a47;
        }
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }
      html { background: var(--bg); color: var(--fg); }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 1.0625rem;
        line-height: 1.7;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      main {
        max-width: 680px;
        margin: 0 auto;
        padding: 56px 28px 96px;
      }
      article > :first-child { margin-top: 0; }
      article img { max-width: 100%; height: auto; display: block; margin: 2rem 0; }

      /* Headings: sans-serif for contrast, sizes from type scale, spacing from ratio scale */
      h1, h2, h3, h4 {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: var(--fg-heading);
        font-weight: 700;
        line-height: 1.15;
      }
      h1 {
        font-size: 2.6rem;
        margin: 0 0 calc(var(--r-1) * 1rem);
        letter-spacing: -0.03em;
        line-height: 1.1;
      }
      h2 {
        font-size: calc(3.2rem / var(--ratio));
        margin: calc(var(--r2) * 1rem) 0 calc(var(--r-1) * 1rem);
        font-weight: 800;
        letter-spacing: -0.025em;
      }
      h3 {
        font-size: calc(3.2rem / var(--ratio) * 0.75);
        margin: calc(var(--r1) * 1rem) 0 calc(var(--r-1) * 1rem);
        letter-spacing: -0.01em;
      }
      h4 {
        font-size: 1rem;
        margin: calc(var(--r1) * 1rem) 0 calc(var(--r-1) * 1rem);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 600;
        color: var(--muted);
      }

      p, ul, ol, pre, blockquote, table, details { margin: 1rem 0; }
      /* Kill margin collapsing after headings — heading's own bottom margin controls the gap */
      h1 + *, h2 + *, h3 + *, h4 + * { margin-top: 0; }
      /* But heading → heading needs breathing room */
      h1 + h2, h1 + h3, h2 + h3, h2 + h4, h3 + h4 { margin-top: calc(var(--r1) * 1rem); }
      li { margin: 0.15rem 0; }
      li > ul, li > ol { margin: calc(var(--r-2) * 1rem) 0; }
      ul, ol { padding-left: 2rem; }
      ul { list-style-type: disc; }
      ul ::marker { color: var(--muted); }
      ol ::marker { color: var(--muted); }
      ul.contains-task-list { list-style: none; padding-left: 1rem; }
      .contains-task-list li { margin: 0; }
      .contains-task-list li:has(input:checked) { opacity: 0.5; }
      .contains-task-list input[type="checkbox"] { margin-right: 0.5rem; }
      .contains-task-list li:has(input:checked) strong { color: inherit; }

      strong { font-weight: 700; color: var(--fg-heading); }
      mark { background: #fef08a; padding: 0.05rem 0.2rem; border-radius: 2px; }
      @media (prefers-color-scheme: dark) { mark { background: #854d0e; color: #fef9c3; } }

      a {
        color: var(--link);
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 0.15em;
        transition: color 120ms ease;
      }
      a:hover, a:focus-visible {
        color: var(--link-hover);
      }

      blockquote {
        margin: 1.75rem 0;
        padding: 0.15rem 0 0.15rem 0.75rem;
        border-left: 2px solid var(--border);
        color: var(--muted);
      }
      blockquote p { font-style: italic; }
      blockquote p:first-child { margin-top: 0; }
      blockquote p:last-child { margin-bottom: 0; }
      blockquote strong { color: inherit; font-style: normal; }

      hr {
        border: none;
        margin: 3rem auto;
        width: 4rem;
        height: 1px;
        background: var(--border);
      }

      /* Code: monospace with a warm paper-like background */
      pre, code {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      }
      pre {
        overflow-x: auto;
        padding: 1.25rem 1.5rem;
        font-size: 0.75rem;
        line-height: 1.6;
        background: var(--code-bg);
        border: none;
        border-radius: 8px;
      }
      code {
        background: var(--code-bg);
        padding: 0.125rem 0.4rem;
        font-size: 0.85em;
        border-radius: 4px;
      }
      .copy-btn {
        position: absolute;
        top: 0.4rem;
        right: 0.4rem;
        background: none;
        border: none;
        color: var(--muted);
        cursor: pointer;
        font-size: 1.4rem;
        padding: 0.35rem;
        opacity: 0;
        transition: opacity 150ms ease;
      }
      pre:hover .copy-btn { opacity: 1; }
      .copy-btn:hover { color: var(--fg); }
      pre code {
        background: transparent;
        padding: 0;
        font-size: inherit;
        border-radius: 0;
        border: none;
      }

      /* Tables: clean, minimal, sans-serif for data */
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 0.875rem;
        line-height: 1.5;
        margin: 2rem 0;
      }
      th {
        padding: 0.6rem 0.85rem;
        text-align: left;
        font-weight: 600;
        color: var(--fg-heading);
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        border-right: 1px solid var(--border);
      }
      th:last-child { border-right: none; }
      td {
        padding: 0.6rem 0.85rem;
        text-align: left;
        border-bottom: 1px solid var(--border);
        border-right: 1px solid var(--border);
      }
      td:last-child { border-right: none; }
      tr:last-child td { border-bottom: none; }

      /* Syntax highlighting: warm, muted palette */
      .hljs-keyword { color: #8b5cf6; }
      .hljs-string { color: #16803c; }
      .hljs-number { color: #b45309; }
      .hljs-comment { color: var(--muted); font-style: italic; }
      .hljs-title, .hljs-function { color: #1d6aa5; }
      .hljs-literal { color: var(--accent); }
      .hljs-built_in { color: #0e7490; }
      .hljs-attr { color: #9d4edd; }
      .hljs-params { color: var(--fg); }
      .hljs-meta { color: var(--muted); }

      @media (prefers-color-scheme: dark) {
        .hljs-keyword { color: #a78bfa; }
        .hljs-string { color: #4ade80; }
        .hljs-number { color: #fbbf24; }
        .hljs-title, .hljs-function { color: #60a5fa; }
        .hljs-built_in { color: #22d3ee; }
      }

      /* TOC navigation — Notion-style: bare lines top-right, popover on hover */
      .toc-wrap {
        position: fixed;
        top: 10rem;
        right: 1.5rem;
        z-index: 100;
        opacity: 1;
      }
      .toc-lines {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        cursor: pointer;
        padding: 4px;
      }
      .toc-lines span {
        display: block;
        height: 2px;
        background: var(--border);
        border-radius: 1px;
        transition: background 150ms ease;
      }
      .toc-lines span.depth-2 { width: 24px; }
      .toc-lines span.depth-3 { width: 14px; }
      .toc-lines span.active { background: var(--fg); }
      .toc-nav {
        position: absolute;
        top: 0;
        right: -0.5rem;
        min-width: 220px;
        max-width: 300px;
        max-height: 70vh;
        overflow-y: auto;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.5rem 0;
        box-shadow: 0 4px 24px rgba(0,0,0,0.1);
        opacity: 0;
        pointer-events: none;
        transform: translateY(-4px);
        transition: opacity 150ms ease, transform 150ms ease;
      }
      .toc-wrap:hover .toc-nav { opacity: 1; pointer-events: auto; transform: translateY(0); }
      .toc-nav a {
        display: block;
        padding: 0.3rem 1rem;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 0.825rem;
        line-height: 1.4;
        color: var(--muted);
        text-decoration: none;
        transition: color 100ms ease, background 100ms ease;
      }
      .toc-nav a:hover { color: var(--fg); background: var(--surface); }
      .toc-nav a.active { color: var(--link); background: var(--surface); }
      .toc-nav a.depth-3 { padding-left: 1.75rem; font-size: 0.8rem; }

      /* Mobile adjustments */
      @media (max-width: 600px) {
        body { font-size: 1rem; }
        main { padding: 32px 20px 64px; }
        h1 { font-size: 2rem; }
        h2 { font-size: 1.5rem; margin-top: 2.5rem; }
        h3 { font-size: 1.2rem; }
        pre { padding: 1rem; font-size: 0.8rem; }
        table { font-size: 0.8rem; }
        th, td { padding: 0.5rem 0.6rem; }
        .toc-wrap { display: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        ${input.bodyHtml}
      </article>
    </main>
    <script>
      document.querySelectorAll('pre').forEach(pre => {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        btn.setAttribute('aria-label', 'Copy code');
        pre.style.position = 'relative';
        pre.appendChild(btn);
        btn.addEventListener('click', () => {
          const code = pre.querySelector('code');
          navigator.clipboard.writeText(code ? code.textContent : pre.textContent);
          btn.textContent = '\u2713';
          setTimeout(() => { btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'; }, 1500);
        });
      });
      // TOC navigation — minimap lines + hover popover
      const headings = document.querySelectorAll('article h2, article h3');
      if (headings.length >= 3) {
        headings.forEach((h, i) => { if (!h.id) h.id = 'h-' + i; });
        const wrap = document.createElement('div');
        wrap.className = 'toc-wrap';
        const lines = document.createElement('div');
        lines.className = 'toc-lines';
        const nav = document.createElement('nav');
        nav.className = 'toc-nav';
        const lineEls = [];
        headings.forEach(h => {
          const line = document.createElement('span');
          const depth = h.tagName === 'H3' ? 'depth-3' : 'depth-2';
          line.className = depth;
          line.dataset.id = h.id;
          lines.appendChild(line);
          lineEls.push(line);
          const a = document.createElement('a');
          a.href = '#' + h.id;
          a.textContent = h.textContent;
          if (h.tagName === 'H3') a.classList.add('depth-3');
          a.addEventListener('click', e => {
            e.preventDefault();
            h.scrollIntoView({ behavior: 'auto', block: 'start' });
          });
          nav.appendChild(a);
        });
        wrap.appendChild(lines);
        wrap.appendChild(nav);
        document.body.appendChild(wrap);
        let activeId = '';
        const obs = new IntersectionObserver(entries => {
          entries.forEach(e => { if (e.isIntersecting) activeId = e.target.id; });
          lineEls.forEach(l => l.classList.toggle('active', l.dataset.id === activeId));
          nav.querySelectorAll('a').forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === '#' + activeId);
          });
        }, { rootMargin: '-10% 0px -80% 0px' });
        headings.forEach(h => obs.observe(h));
      }
    </script>
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

  return "Published with pubmd.";
}

/**
 * Converts bare URLs (e.g. github.com/foo/bar) into markdown links.
 * Skips URLs already inside markdown links [text](url), inline code `...`,
 * code blocks ```, and URLs that already have a protocol.
 */
export function autolinkBareUrls(markdown: string): string {
  const lines = markdown.split("\n");
  let inCodeBlock = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    result.push(autolinkLine(line));
  }

  return result.join("\n");
}

const BARE_URL_RE =
  /(?:^|(?<=\s|:\s))(?:([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|dev|sh|co|me|ai|app|xyz|pub|page|blog|wiki|info|edu|gov|to|ph|rs|fm|gg|cc|tv|im|ly|so|ac|is|it|nl|de|uk|fr|ch|au|ca|us|in|jp))(?:\/[^\s)}\]]*)?/gi;

function autolinkLine(line: string): string {
  // Skip lines that are inside inline code spans
  const segments: string[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const tickIndex = remaining.indexOf("`");

    if (tickIndex === -1) {
      segments.push(replaceUrls(remaining));
      break;
    }

    segments.push(replaceUrls(remaining.slice(0, tickIndex)));

    const closeIndex = remaining.indexOf("`", tickIndex + 1);

    if (closeIndex === -1) {
      segments.push(remaining.slice(tickIndex));
      break;
    }

    segments.push(remaining.slice(tickIndex, closeIndex + 1));
    remaining = remaining.slice(closeIndex + 1);
  }

  return segments.join("");
}

/**
 * Strips Obsidian-style [[wikilinks]] to plain text or links.
 * [[page]] → page, [[url.com/path]] → url.com/path (autolinker handles the rest)
 */
/** Converts ==highlighted text== to <mark> tags */
function convertHighlights(markdown: string): string {
  return markdown.replace(/==((?!=).+?)==/g, "<mark>$1</mark>");
}

function stripWikilinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, "$1");
}

function replaceUrls(text: string): string {
  return text.replace(BARE_URL_RE, (match) => {
    return `[${match}](https://${match})`;
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
