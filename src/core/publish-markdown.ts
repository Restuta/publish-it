import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PrepareMarkdownBodyOptions {
  sourcePath?: string;
}

const LOCAL_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
]);
const EXCALIDRAW_MARKDOWN_SUFFIX = ".excalidraw.md";
const EXCALIDRAW_EXPORT_EXTENSIONS = [".svg", ".png", ".webp", ".jpg", ".jpeg"];

const OBSIDIAN_IMAGE_EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g;

export async function prepareMarkdownBodyForPublish(
  markdownBody: string,
  options: PrepareMarkdownBodyOptions = {},
): Promise<string> {
  if (options.sourcePath === undefined) {
    return markdownBody;
  }

  const baseDir = path.dirname(options.sourcePath);

  return transformOutsideCodeBlocks(markdownBody, async (segment) => {
    const withObsidianEmbeds = await replaceAsync(
      segment,
      OBSIDIAN_IMAGE_EMBED_RE,
      async (match, innerTarget) => {
        const [rawTarget] = innerTarget.split("|");
        const target = rawTarget?.trim();

        if (target === undefined || target.length === 0) {
          return match;
        }

        const asset = await resolveLocalImageAsset(baseDir, target);

        if (asset === null) {
          return match;
        }

        return `![${asset.alt}](${asset.dataUrl})`;
      },
    );

    return replaceAsync(
      withObsidianEmbeds,
      MARKDOWN_IMAGE_RE,
      async (match, alt, rawTarget) => {
        const target = normalizeMarkdownImageTarget(rawTarget);

        if (target === null || isExternalAssetTarget(target)) {
          return match;
        }

        const asset = await resolveLocalImageAsset(baseDir, target);

        if (asset === null) {
          return match;
        }

        const label = alt.trim().length > 0 ? alt.trim() : asset.alt;
        return `![${escapeMarkdownLabel(label)}](${asset.dataUrl})`;
      },
    );
  });
}

async function transformOutsideCodeBlocks(
  markdown: string,
  transform: (segment: string) => Promise<string>,
): Promise<string> {
  const lines = markdown.split("\n");
  const result: string[] = [];
  const buffer: string[] = [];
  let inCodeBlock = false;

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }

    result.push(await transform(buffer.join("\n")));
    buffer.length = 0;
  }

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      await flushBuffer();
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    buffer.push(line);
  }

  await flushBuffer();

  return result.join("\n");
}

async function replaceAsync(
  text: string,
  pattern: RegExp,
  replacer: (...args: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...text.matchAll(pattern)];

  if (matches.length === 0) {
    return text;
  }

  let result = "";
  let lastIndex = 0;

  for (const match of matches) {
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;
    result += text.slice(lastIndex, matchIndex);
    result += await replacer(...match);
    lastIndex = matchIndex + fullMatch.length;
  }

  result += text.slice(lastIndex);
  return result;
}

function normalizeMarkdownImageTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

  const withOptionalTitle = trimmed.match(/^(\S+)(?:\s+["'][^"']*["'])?$/);
  return withOptionalTitle?.[1] ?? trimmed;
}

function isExternalAssetTarget(target: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(target) || target.startsWith("data:");
}

async function resolveLocalImageAsset(
  baseDir: string,
  rawTarget: string,
): Promise<{ alt: string; dataUrl: string } | null> {
  const excalidrawExportPath = await resolveExcalidrawExportPath(
    baseDir,
    rawTarget,
  );
  const resolvedPath = excalidrawExportPath ?? path.resolve(baseDir, rawTarget);
  const extension = path.extname(resolvedPath).toLowerCase();

  if (!LOCAL_IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  try {
    const content = await readFile(resolvedPath);
    return {
      alt: escapeMarkdownLabel(
        path.basename(
          excalidrawExportPath === null
            ? rawTarget
            : rawTarget.replace(/\.excalidraw\.md$/i, extension),
        ),
      ),
      dataUrl: buildDataUrl(content, extension),
    };
  } catch {
    return null;
  }
}

async function resolveExcalidrawExportPath(
  baseDir: string,
  rawTarget: string,
): Promise<string | null> {
  if (!rawTarget.toLowerCase().endsWith(EXCALIDRAW_MARKDOWN_SUFFIX)) {
    return null;
  }

  const absoluteTarget = path.resolve(baseDir, rawTarget);
  const exportBasePath = absoluteTarget.slice(
    0,
    -EXCALIDRAW_MARKDOWN_SUFFIX.length,
  );

  for (const extension of EXCALIDRAW_EXPORT_EXTENSIONS) {
    const candidatePath = `${exportBasePath}${extension}`;

    try {
      await readFile(candidatePath);
      return candidatePath;
    } catch {
      // Try the next export format.
    }
  }

  return null;
}

function buildDataUrl(content: Buffer, extension: string): string {
  return `data:${mimeTypeForExtension(extension)};base64,${content.toString("base64")}`;
}

function mimeTypeForExtension(extension: string): string {
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}
