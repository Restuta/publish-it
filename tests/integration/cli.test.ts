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

  it("renders local image embeds while preserving the original raw markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-img-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "note.md");
    const imagePath = path.join(cwd, "diagram.svg");

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="green"/></svg>',
      "utf8",
    );
    await writeFile(
      notePath,
      `---
title: Embedded Image
---

Look:

![[diagram.svg|320x200]]
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

    const publishResult = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    const pageUrl = publishResult.stdout.trim();

    const htmlResponse = await fetch(pageUrl);
    const html = await htmlResponse.text();
    expect(html).toContain("data:image/svg+xml;base64,");

    const rawResponse = await fetch(`${pageUrl}?raw=1`);
    const rawMarkdown = await rawResponse.text();
    expect(rawMarkdown).toContain("![[diagram.svg|320x200]]");
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
      ["./node_modules/tsx/dist/cli.mjs", "src/cli/main.ts", ...args],
      {
        cwd: repoRoot,
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
