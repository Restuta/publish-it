# pubmd

> `stdout` for the web — one command, one URL, done.

Publish markdown to a stable URL. Built for AI agents, usable by humans.

**Live at [bul.sh](https://bul.sh)**

## Current Status

- Live service: `https://bul.sh`
- Publish model: pre-render once on publish, then serve cached HTML
- Content storage: public Blob
- Metadata storage: private Blob
- Read path on Vercel: Hono + aggressive edge caching
- Published pages are effectively immutable unless explicitly republished

## Run From Source

```bash
git clone https://github.com/Restuta/pubmd.git
cd pubmd
npm install
npm run build

# Local CLI usage from source
node dist/src/cli/main.js --help
```

## Install

**macOS / Linux:**
```bash
curl -fsSL https://bul.sh/install | sh
```

**Windows (PowerShell):**
```powershell
irm https://bul.sh/install.ps1 | iex
```

**npm (any platform):**
```bash
npx pubmd --help
```

Default behavior (macOS/Linux):
- installs `pubmd` to `~/.local/bin`
- does not require `sudo`
- prints a PATH hint if `~/.local/bin` is not already on your shell PATH

Default behavior (Windows):
- installs `pubmd.exe` to `%LOCALAPPDATA%\pubmd`
- adds to user PATH automatically

## Quick Start

```bash
# Claim your namespace
node dist/src/cli/main.js claim myname --api-base https://bul.sh

# Publish
node dist/src/cli/main.js publish notes.md --api-base https://bul.sh
# → https://bul.sh/myname/notes

# Re-publish (same URL, updated content)
node dist/src/cli/main.js publish notes.md --api-base https://bul.sh

# Pipe from stdin
cat report.md | node dist/src/cli/main.js publish --slug weekly-report --namespace myname --api-base https://bul.sh

# List your pages
node dist/src/cli/main.js list --namespace myname --api-base https://bul.sh

# Delete a page
node dist/src/cli/main.js remove weekly-report --namespace myname --api-base https://bul.sh
```


## For AI Agents

Any AI that can run shell commands can publish. No SDK, no MCP, no API client — just a command.

### Claude Code

A `/publish` skill is available. Usage:

```
/publish report.md
/publish report.md --slug weekly-report
```

Or add this to your project's `CLAUDE.md`:

```
To share long-form output as a URL, use:
  pubmd publish <file.md> --api-base https://bul.sh
The command prints the live URL to stdout.
```

### Codex / Other AI agents

Add to `AGENTS.md` or system prompt:

```
To publish markdown to a shareable URL:
  pubmd publish <file.md> --api-base https://bul.sh
To list published pages:
  pubmd list --api-base https://bul.sh
```

### Windows AI agents

If running on Windows, use `npx`:

```
npx pubmd publish <file.md> --api-base https://bul.sh
```

Or if installed via PowerShell:

```
pubmd publish <file.md> --api-base https://bul.sh
```

### Zero-dependency (curl)

Any agent that can run curl can publish without installing anything:

```bash
# Publish raw markdown
curl -X POST -H "Authorization: Bearer $TOKEN" \
  --data-binary @file.md \
  https://bul.sh/api/namespaces/myname/pages/publish

# Claim namespace (one-time)
curl -s -X POST https://bul.sh/api/namespaces/myname/claim
```

## Frontmatter

Control page metadata with YAML frontmatter:

```yaml
---
title: My Report
slug: custom-url-slug
description: A short summary for social previews
noindex: false        # default: true
visibility: public    # stored as metadata for now
draft: true           # stored as metadata for now
---

# My Report

Content here...
```

All fields are optional. Title and description are auto-extracted from content if not specified.

Today:
- `title`, `slug`, `description`, and `noindex` affect rendered output/metadata
- `visibility` and `draft` are stored as page metadata, but are not yet enforced in listing/access rules

## How It Works

```
PUBLISH: CLI posts markdown -> server renders HTML once -> stores raw markdown + HTML in Blob
READ:    Browser hits URL -> app serves pre-rendered HTML with aggressive Vercel edge caching
```

Pages are pre-rendered on publish. On Vercel, the first read may hit the app, but subsequent reads are served from edge cache for the cache window. Zero JS, system fonts, small HTML payloads.

## Immutable Publishing Model

- A publish creates a rendered snapshot
- Existing pages do not change unless explicitly republished
- Renderer/style improvements apply to newly published or explicitly republished pages
- This avoids silent regressions in old documents when styles change

## CLI Reference

```
node dist/src/cli/main.js claim <namespace>                                 Claim a namespace, get API token
node dist/src/cli/main.js publish [file] [--slug <s>] [--namespace <n>]     Publish or update a page
node dist/src/cli/main.js list [--namespace <n>]                             List your published pages
node dist/src/cli/main.js remove <slug> [--namespace <n>]                    Delete a page
```

Config stored in `~/.config/pub/config.json`. File-to-URL mappings stored in `.pub` in the working directory.

## Development

```bash
npm run dev          # local server with hot reload
npm test             # run tests
npm run verify       # test + lint + typecheck + build
```

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/namespaces/:ns/claim` | none | Claim namespace, returns token |
| POST | `/api/namespaces/:ns/pages/publish` | Bearer | Publish/update a page |
| GET | `/api/namespaces/:ns/pages` | Bearer | List pages |
| DELETE | `/api/namespaces/:ns/pages/:slug` | Bearer | Delete a page |
| GET | `/:ns/:slug` | none | Read published page (HTML) |
| GET | `/:ns/:slug?raw` | none | Read raw markdown |
