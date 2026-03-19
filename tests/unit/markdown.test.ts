import { describe, expect, it } from "vitest";

import {
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
    expect(html).toContain(
      "box-shadow: inset 0 -0.35em 0 var(--link-highlight)",
    );
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
