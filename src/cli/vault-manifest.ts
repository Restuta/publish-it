import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const VaultPageSchema = z.object({
  namespace: z.string().min(1),
  pageId: z.string().uuid(),
  slug: z.string().min(1),
  source: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string().datetime(),
  url: z.string().url(),
});

const VaultManifestSchema = z.object({
  pages: z.array(VaultPageSchema),
});

export type VaultManifest = z.infer<typeof VaultManifestSchema>;
export type VaultManifestEntry = z.infer<typeof VaultPageSchema>;

const OBSIDIAN_DIR_NAME = ".obsidian";

export async function findVaultRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);

  while (true) {
    if (await pathExists(path.join(currentPath, OBSIDIAN_DIR_NAME))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

export function getVaultManifestPath(vaultRoot: string): string {
  return path.join(vaultRoot, ".pubmd", "pages.toml");
}

export async function loadVaultManifest(
  manifestPath: string,
): Promise<VaultManifest> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return VaultManifestSchema.parse(parseVaultManifestToml(raw));
  } catch (error) {
    if (isMissingFile(error)) {
      return { pages: [] };
    }

    throw error;
  }
}

export async function saveVaultManifest(
  manifest: VaultManifest,
  manifestPath: string,
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const sortedManifest = {
    pages: [...manifest.pages].sort((left, right) =>
      left.source.localeCompare(right.source),
    ),
  };
  await writeFile(
    manifestPath,
    `${serializeVaultManifestToml(sortedManifest)}\n`,
  );
}

export function normalizeVaultRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function upsertVaultManifestEntry(
  manifest: VaultManifest,
  entry: VaultManifestEntry,
): VaultManifest {
  const pages = manifest.pages.filter((page) => page.source !== entry.source);
  pages.push(entry);
  return { pages };
}

export function findVaultManifestEntry(
  manifest: VaultManifest,
  source: string,
): VaultManifestEntry | undefined {
  return manifest.pages.find((page) => page.source === source);
}

function parseVaultManifestToml(raw: string): VaultManifest {
  const lines = raw.split(/\r?\n/);
  const pages: Array<Record<string, string>> = [];
  let currentPage: Record<string, string> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    if (line === "[[pages]]") {
      currentPage = {};
      pages.push(currentPage);
      continue;
    }

    if (currentPage === null) {
      throw new Error("Invalid vault manifest: expected [[pages]] block.");
    }

    const match = line.match(/^([a-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"$/);

    if (match === null) {
      throw new Error(`Invalid vault manifest line: ${line}`);
    }

    const [, key, value] = match;

    if (key === undefined || value === undefined) {
      throw new Error(`Invalid vault manifest line: ${line}`);
    }

    currentPage[key] = unescapeTomlString(value);
  }

  return { pages: pages.map((page) => mapParsedPage(page)) };
}

function serializeVaultManifestToml(manifest: VaultManifest): string {
  return manifest.pages
    .map((page) =>
      [
        "[[pages]]",
        `source = "${escapeTomlString(page.source)}"`,
        `namespace = "${escapeTomlString(page.namespace)}"`,
        `slug = "${escapeTomlString(page.slug)}"`,
        `page_id = "${escapeTomlString(page.pageId)}"`,
        `url = "${escapeTomlString(page.url)}"`,
        `title = "${escapeTomlString(page.title)}"`,
        `updated_at = "${escapeTomlString(page.updatedAt)}"`,
      ].join("\n"),
    )
    .join("\n\n");
}

function mapParsedPage(page: Record<string, string>): VaultManifestEntry {
  return VaultPageSchema.parse({
    namespace: page["namespace"],
    pageId: page["page_id"],
    slug: page["slug"],
    source: page["source"],
    title: page["title"],
    updatedAt: page["updated_at"],
    url: page["url"],
  });
}

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function unescapeTomlString(value: string): string {
  return value.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
