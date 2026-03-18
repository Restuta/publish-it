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
});
