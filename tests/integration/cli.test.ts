import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type StartedTestServer, startTestServer } from "./test-server.js";

const repoRoot = process.cwd();

describe("cli integration", () => {
  let server: StartedTestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("claims, publishes, republishes, lists, and removes through the real CLI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "note.md");

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      notePath,
      `---
title: First Note
---

Hello from CLI.
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });

    const firstPublish = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    const firstUrl = firstPublish.stdout.trim();
    expect(firstUrl).toContain("/restuta/first-note");

    await writeFile(
      notePath,
      `---
title: First Note
---

Updated body.
`,
      "utf8",
    );

    const secondPublish = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    expect(secondPublish.stdout.trim()).toBe(firstUrl);

    const publicResponse = await fetch(firstUrl);
    expect(await publicResponse.text()).toContain("Updated body.");

    const listResult = await runCli(["list", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });
    expect(listResult.stdout).toContain("first-note");

    await runCli(["remove", "first-note", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });

    const removedResponse = await fetch(firstUrl);
    expect(removedResponse.status).toBe(404);

    const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as {
      files: Record<string, unknown>;
    };
    expect(Object.keys(mapping.files)).toHaveLength(0);
  });

  it("writes a vault manifest and reuses it across working directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-vault-"));
    const configDir = path.join(root, "config");
    const firstMappingPath = path.join(root, "first.pub");
    const secondMappingPath = path.join(root, "second.pub");
    const vaultRoot = path.join(root, "vault");
    const firstCwd = path.join(vaultRoot, "notes");
    const secondCwd = vaultRoot;
    const notePath = path.join(firstCwd, "vision.md");
    const manifestPath = path.join(vaultRoot, ".pubmd", "pages.toml");

    server = await startTestServer(root);
    await mkdir(path.join(vaultRoot, ".obsidian"), { recursive: true });
    await mkdir(firstCwd, { recursive: true });
    await writeFile(
      notePath,
      `---
title: Product Vision
---

First version.
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd: firstCwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: firstMappingPath,
      },
    });

    const firstUrl = (
      await runCli(["publish", notePath, "--api-base", server.origin], {
        cwd: firstCwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: firstMappingPath,
        },
      })
    ).stdout.trim();

    const manifestContents = await readFile(manifestPath, "utf8");
    expect(manifestContents).toContain('source = "notes/vision.md"');
    expect(manifestContents).toContain('slug = "product-vision"');
    expect(manifestContents).toContain(firstUrl);

    await writeFile(
      notePath,
      `---
title: Product Vision Renamed
---

Updated body.
`,
      "utf8",
    );

    const secondPublish = await runCli(
      ["publish", path.join("notes", "vision.md"), "--api-base", server.origin],
      {
        cwd: secondCwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: secondMappingPath,
        },
      },
    );
    const secondUrl = secondPublish.stdout.trim();

    expect(secondUrl).toBe(firstUrl);

    const pageResponse = await fetch(firstUrl);
    expect(await pageResponse.text()).toContain("Updated body.");
  });
});

async function runCli(
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
  },
): Promise<{ stderr: string; stdout: string }> {
  await mkdirIfNeeded(options.cwd);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"),
        path.join(repoRoot, "src/cli/main.ts"),
        ...args,
      ],
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`CLI exited with code ${code}: ${stderr}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function mkdirIfNeeded(target: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(target, { recursive: true });
}
