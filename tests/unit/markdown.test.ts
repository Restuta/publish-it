import { describe, expect, it } from "vitest";

import {
  autolinkBareUrls,
  buildHtmlDocument,
  parseMarkdownDocument,
  renderMarkdownToHtml,
} from "../../src/core/markdown.js";

describe("markdown pipeline", () => {
  it("extracts frontmatter and sensible defaults", () => {
    const parsed = parseMarkdownDocument(`---
title: Launch Notes
noindex: false
---

# Hello

This is a release note.`);

    expect(parsed.title).toBe("Launch Notes");
    expect(parsed.noindex).toBe(false);
    expect(parsed.description).toBe("This is a release note.");
  });

  it("renders GFM markdown and wraps html document metadata", async () => {
    const rendered = await renderMarkdownToHtml(`
## Demo

| name | value |
| --- | --- |
| foo | bar |

\`\`\`ts
const answer = 42;
\`\`\`
`);
    const html = buildHtmlDocument({
      title: "Demo",
      description: "Example",
      noindex: true,
      bodyHtml: rendered.html,
    });

    expect(rendered.html).toContain("<table>");
    expect(rendered.html).toContain("language-ts");
    expect(html).toContain('meta name="robots" content="noindex,nofollow"');
    expect(html).toContain('rel="icon"');
    expect(html).toContain("--link:");
    expect(html).toContain("text-underline-offset");
  });

  it("builds adaptive TOC logic for documents that use body h1 headings", () => {
    const html = buildHtmlDocument({
      title: "Doc Title",
      description: "Example",
      noindex: true,
      bodyHtml:
        "<h1>Doc Title</h1><h1>Section</h1><h2>Child</h2><h1>Another</h1>",
    });

    expect(html).toContain("article h1, article h2, article h3, article h4");
    expect(html).toContain('const pageTitle = "Doc Title";');
    expect(html).toContain("depth-root");
    expect(html).toContain("depth-child");
  });

  it("renders real-world mixed markdown structures cleanly", async () => {
    const rendered = await renderMarkdownToHtml(`
# Publish-It — Project Plan

Like [telegra.ph](https://telegra.ph) but for the terminal era.

> One command, one URL, done.

- Why Build This
  - JotBird exists
  - Rentry exists
- Philosophy
  - stable URLs
  - simple publishing

1. Claim namespace
2. Publish markdown

\`inline code\`

\`\`\`
CLI or curl
  ↓ HTTP POST with Bearer token
Edge Function (Hono)
  ↓
Stores raw .md + pre-rendered .html
\`\`\`
`);

    expect(rendered.html).toContain("<h1>Publish-It");
    expect(rendered.html).toContain('<a href="https://telegra.ph">');
    expect(rendered.html).toContain("<blockquote>");
    expect(rendered.html).toContain("<ul>");
    expect(rendered.html).toContain("<ol>");
    expect(rendered.html).toContain("<code>inline code</code>");
    expect(rendered.html).toContain("<pre><code>CLI or curl");
    expect(rendered.html).toContain("Edge Function (Hono)");
  });
});

describe("autolinkBareUrls", () => {
  it("links bare domain URLs", () => {
    expect(autolinkBareUrls("check github.com/foo/bar for details")).toBe(
      "check [github.com/foo/bar](https://github.com/foo/bar) for details",
    );
  });

  it("links bare domain without path", () => {
    expect(autolinkBareUrls("visit hono.dev")).toBe(
      "visit [hono.dev](https://hono.dev)",
    );
  });

  it("handles multiple bare URLs on one line", () => {
    const input = "see github.com/a and npmjs.com/b";
    const result = autolinkBareUrls(input);
    expect(result).toContain("[github.com/a](https://github.com/a)");
    expect(result).toContain("[npmjs.com/b](https://npmjs.com/b)");
  });

  it("does not double-link existing markdown links", () => {
    const input = "[Quartz](https://github.com/jackyzha0/quartz)";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("does not link URLs that already have a protocol", () => {
    const input = "see https://github.com/foo/bar";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("does not link URLs inside inline code", () => {
    const input = "use `github.com/foo/bar` for this";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("does not link URLs inside code blocks", () => {
    const input = "text\n```\ngithub.com/foo/bar\n```\nmore text";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("links URLs with various TLDs", () => {
    for (const url of [
      "example.io/path",
      "tool.sh",
      "app.dev/docs",
      "site.co/page",
      "telegra.ph",
      "paste.rs",
      "listed.to",
    ]) {
      const result = autolinkBareUrls(url);
      expect(result).toBe(`[${url}](https://${url})`);
    }
  });

  it("renders bare URLs as clickable links in HTML output", async () => {
    const rendered = await renderMarkdownToHtml(
      "Quartz source: github.com/jackyzha0/quartz",
    );
    expect(rendered.html).toContain(
      'href="https://github.com/jackyzha0/quartz"',
    );
  });

  it("strips wikilinks and autolinks URLs inside them", async () => {
    const rendered = await renderMarkdownToHtml(
      "like [[telegra.ph]] but for the terminal era",
    );
    expect(rendered.html).toContain('href="https://telegra.ph"');
    expect(rendered.html).not.toContain("[[");
  });

  it("strips wikilinks that are not URLs", async () => {
    const rendered = await renderMarkdownToHtml(
      "see [[jotbird-analysis]] for details",
    );
    expect(rendered.html).not.toContain("[[");
    expect(rendered.html).toContain("jotbird-analysis");
  });
});
