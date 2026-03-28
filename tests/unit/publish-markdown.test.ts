import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prepareMarkdownBodyForPublish } from "../../src/core/publish-markdown.js";

describe("prepareMarkdownBodyForPublish", () => {
  it("converts Obsidian image embeds into data URL markdown images", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-image-embed-"));
    const notePath = path.join(root, "note.md");
    const imagePath = path.join(root, "diagram.svg");

    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
      "utf8",
    );

    const prepared = await prepareMarkdownBodyForPublish(
      "Before\n\n![[diagram.svg|400x300]]\n\nAfter",
      {
        sourcePath: notePath,
      },
    );

    expect(prepared).toContain("data:image/svg+xml;base64,");
    expect(prepared).not.toContain("![[diagram.svg");
  });

  it("converts relative markdown image paths into data URLs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-inline-image-"));
    const notePath = path.join(root, "note.md");
    const imagePath = path.join(root, "assets", "photo.svg");

    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="blue"/></svg>',
      "utf8",
    );

    const prepared = await prepareMarkdownBodyForPublish(
      "![Team photo](./assets/photo.svg)",
      {
        sourcePath: notePath,
      },
    );

    expect(prepared).toContain("![Team photo](data:image/svg+xml;base64,");
  });

  it("resolves Excalidraw embeds to sibling exported images", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-excalidraw-"));
    const notePath = path.join(root, "note.md");
    const drawingPath = path.join(root, "diagram.excalidraw.md");
    const exportPath = path.join(root, "diagram.svg");

    await writeFile(
      drawingPath,
      `---
excalidraw-plugin: parsed
---
`,
      "utf8",
    );
    await writeFile(
      exportPath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="orange"/></svg>',
      "utf8",
    );

    const prepared = await prepareMarkdownBodyForPublish(
      "Here:\n\n![[diagram.excalidraw.md]]",
      {
        sourcePath: notePath,
      },
    );

    expect(prepared).toContain("data:image/svg+xml;base64,");
    expect(prepared).not.toContain("![[diagram.excalidraw.md]]");
  });
});
