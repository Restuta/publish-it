#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ClaimNamespaceResponseSchema,
  ListPagesResponseSchema,
  PublishedPageSchema,
} from "../core/contract.js";
import {
  loadConfig,
  loadMapping,
  resolveApiBase,
  saveConfig,
  saveMapping,
} from "./config.js";
import {
  findVaultManifestEntry,
  findVaultRoot,
  getVaultManifestPath,
  loadVaultManifest,
  normalizeVaultRelativePath,
  saveVaultManifest,
  upsertVaultManifestEntry,
} from "./vault-manifest.js";

interface CommandContext {
  args: string[];
}

interface CliOptions {
  "api-base"?: string;
  namespace?: string;
  slug?: string;
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;

  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    printHelp();
    return;
  }

  const [command, ...rest] = argv;
  const context: CommandContext = { args: rest };

  switch (command) {
    case "claim":
      await runClaim(context);
      return;
    case "publish":
      await runPublish(context);
      return;
    case "list":
      await runList(context);
      return;
    case "remove":
      await runRemove(context);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runClaim(context: CommandContext): Promise<void> {
  const [namespace, ...rest] = context.args;

  if (namespace === undefined) {
    throw new Error("Usage: pub claim <namespace> [--api-base <url>]");
  }

  const options = parseOptions(rest);
  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);
  const response = await fetch(
    `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/claim`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const claimed = ClaimNamespaceResponseSchema.parse(await response.json());
  config.apiBaseUrl = apiBase;
  config.defaultNamespace ??= claimed.namespace;
  config.namespaces[claimed.namespace] = {
    token: claimed.token,
  };
  await saveConfig(config);
  console.log(`Claimed namespace ${claimed.namespace}`);
}

async function runPublish(context: CommandContext): Promise<void> {
  const { positional, options } = splitArgs(context.args);
  const filePath = positional[0];
  const absoluteFilePath =
    filePath === undefined ? undefined : path.resolve(filePath);
  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);
  const mapping = await loadMapping();
  const vaultRoot =
    absoluteFilePath === undefined
      ? null
      : await findVaultRoot(path.dirname(absoluteFilePath));
  const vaultManifestPath =
    vaultRoot === null ? null : getVaultManifestPath(vaultRoot);
  const vaultSourcePath =
    absoluteFilePath === undefined || vaultRoot === null
      ? undefined
      : normalizeVaultRelativePath(path.relative(vaultRoot, absoluteFilePath));
  const vaultManifest =
    vaultManifestPath === null
      ? null
      : await loadVaultManifest(vaultManifestPath);
  const manifestEntry =
    vaultManifest === null || vaultSourcePath === undefined
      ? undefined
      : findVaultManifestEntry(vaultManifest, vaultSourcePath);
  const mappingKey =
    absoluteFilePath === undefined
      ? undefined
      : path.relative(process.cwd(), absoluteFilePath);
  const existingMapping =
    mappingKey === undefined ? undefined : mapping.files[mappingKey];
  const existingPage = manifestEntry ?? existingMapping;
  const namespace =
    options.namespace ?? existingPage?.namespace ?? config.defaultNamespace;

  if (namespace === undefined) {
    throw new Error(
      "No namespace configured. Run `pub claim <namespace>` first.",
    );
  }

  const token = config.namespaces[namespace]?.token;

  if (token === undefined) {
    throw new Error(`No token configured for namespace "${namespace}".`);
  }

  const markdown =
    absoluteFilePath === undefined
      ? await readStdin()
      : await readFile(absoluteFilePath, "utf8");
  const response = await fetch(
    `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/pages/publish`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        markdown,
        ...((options.slug ?? existingPage?.slug) === undefined
          ? {}
          : { slug: options.slug ?? existingPage?.slug }),
        ...(existingPage?.pageId === undefined
          ? {}
          : { pageId: existingPage.pageId }),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const published = PublishedPageSchema.parse(await response.json());

  if (mappingKey !== undefined) {
    mapping.files[mappingKey] = {
      namespace: published.namespace,
      pageId: published.pageId,
      slug: published.slug,
      url: published.url,
    };
    await saveMapping(mapping);
  }

  if (
    vaultManifest !== null &&
    vaultManifestPath !== null &&
    vaultSourcePath !== undefined
  ) {
    const nextManifest = upsertVaultManifestEntry(vaultManifest, {
      namespace: published.namespace,
      pageId: published.pageId,
      slug: published.slug,
      source: vaultSourcePath,
      title: published.title,
      updatedAt: new Date().toISOString(),
      url: published.url,
    });
    await saveVaultManifest(nextManifest, vaultManifestPath);
  }

  console.log(published.url);
}

async function runList(context: CommandContext): Promise<void> {
  const all = context.args.includes("--all");
  const filtered = context.args.filter((a) => a !== "--all");
  const { options } = splitArgs(filtered);
  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);

  const namespacesToList = all
    ? Object.keys(config.namespaces)
    : [options.namespace ?? config.defaultNamespace].filter(
        (ns): ns is string => ns !== undefined,
      );

  if (namespacesToList.length === 0) {
    throw new Error(
      "No namespace configured. Run `pubmd claim <namespace>` first.",
    );
  }

  for (const namespace of namespacesToList) {
    const token = config.namespaces[namespace]?.token;

    if (token === undefined) {
      continue;
    }

    const response = await fetch(
      `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/pages`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      continue;
    }

    const payload = ListPagesResponseSchema.parse(await response.json());

    if (payload.pages.length === 0 && !all) {
      console.log("No pages published.");
      continue;
    }

    if (payload.pages.length === 0) {
      continue;
    }

    if (all) {
      console.log(`\n${namespace}/`);
    }

    for (const page of payload.pages) {
      const prefix = all ? "  " : "";
      console.log(`${prefix}${page.slug}\t${page.url}`);
    }
  }
}

async function runRemove(context: CommandContext): Promise<void> {
  const { positional, options } = splitArgs(context.args);
  const slug = positional[0];

  if (slug === undefined) {
    throw new Error(
      "Usage: pub remove <slug> [--namespace <namespace>] [--api-base <url>]",
    );
  }

  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);
  const namespace = options.namespace ?? config.defaultNamespace;

  if (namespace === undefined) {
    throw new Error(
      "No namespace configured. Run `pub claim <namespace>` first.",
    );
  }

  const token = config.namespaces[namespace]?.token;

  if (token === undefined) {
    throw new Error(`No token configured for namespace "${namespace}".`);
  }

  const response = await fetch(
    `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/pages/${encodeURIComponent(slug)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const mapping = await loadMapping();
  let mappingChanged = false;

  for (const [key, value] of Object.entries(mapping.files)) {
    if (value.namespace === namespace && value.slug === slug) {
      delete mapping.files[key];
      mappingChanged = true;
    }
  }

  if (mappingChanged) {
    await saveMapping(mapping);
  }

  console.log(`Removed ${namespace}/${slug}`);
}

function parseOptions(argumentsList: string[]): CliOptions {
  return splitArgs(argumentsList).options;
}

function splitArgs(argumentsList: string[]): {
  options: CliOptions;
  positional: string[];
} {
  const options: CliOptions = {};
  const positional: string[] = [];

  for (let index = 0; index < argumentsList.length; index += 1) {
    const current = argumentsList[index];

    if (current === undefined) {
      break;
    }

    if (!current.startsWith("--")) {
      positional.push(current);
      continue;
    }

    const key = current.slice(2);
    const value = argumentsList[index + 1];

    if (!isCliOptionKey(key)) {
      throw new Error(`Unknown option: --${key}`);
    }

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Expected value after ${current}`);
    }

    options[key] = value;
    index += 1;
  }

  return { options, positional };
}

function isCliOptionKey(value: string): value is keyof CliOptions {
  return value === "api-base" || value === "namespace" || value === "slug";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function printHelp(): void {
  console.log(`Usage:
  pubmd claim <namespace> [--api-base <url>]
  pubmd publish [file] [--namespace <namespace>] [--slug <slug>] [--api-base <url>]
  pubmd list [--namespace <namespace>] [--all] [--api-base <url>]
  pubmd remove <slug> [--namespace <namespace>] [--api-base <url>]`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unexpected CLI error.";
  console.error(message);
  process.exitCode = 1;
});
