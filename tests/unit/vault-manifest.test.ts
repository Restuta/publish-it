import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findVaultManifestEntry,
  findVaultRoot,
  loadVaultManifest,
  normalizeVaultRelativePath,
  saveVaultManifest,
  upsertVaultManifestEntry,
} from "../../src/cli/vault-manifest.js";

describe("vault manifest", () => {
  it("finds the nearest Obsidian vault root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-vault-root-"));
    const vaultRoot = path.join(root, "vault");
    const nestedDir = path.join(vaultRoot, "notes", "deep");

    await mkdir(path.join(vaultRoot, ".obsidian"), { recursive: true });
    await mkdir(nestedDir, { recursive: true });

    expect(await findVaultRoot(nestedDir)).toBe(vaultRoot);
  });

  it("round-trips TOML manifest entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-vault-manifest-"));
    const manifestPath = path.join(root, ".pubmd", "pages.toml");
    const manifest = upsertVaultManifestEntry(
      { pages: [] },
      {
        namespace: "a",
        pageId: "123e4567-e89b-12d3-a456-426614174000",
        slug: "orba-vision",
        source: "10-product/00-vision-v1.md",
        title: "Product Vision v1",
        updatedAt: "2026-03-27T00:00:00.000Z",
        url: "https://bul.sh/a/orba-vision",
      },
    );

    await saveVaultManifest(manifest, manifestPath);
    const loaded = await loadVaultManifest(manifestPath);

    expect(
      findVaultManifestEntry(loaded, "10-product/00-vision-v1.md"),
    ).toEqual(manifest.pages[0]);
  });

  it("normalizes vault-relative paths to forward slashes", () => {
    expect(normalizeVaultRelativePath(`notes${path.sep}doc.md`)).toBe(
      "notes/doc.md",
    );
  });
});
