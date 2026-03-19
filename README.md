# Publish It

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
git clone https://github.com/Restuta/publish-it.git
cd publish-it
npm install
npm run build

# Local CLI usage from source
node dist/src/cli/main.js --help
```

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

## Zero-Install (curl)

No CLI needed. Any tool that can run curl can publish:

```bash
# Claim namespace
curl -s -X POST https://bul.sh/api/namespaces/myname/claim

# Publish from a file
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @<(jq -Rs '{markdown: .}' file.md) \
  https://bul.sh/api/namespaces/myname/pages/publish

# With custom slug
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"markdown": "# Hello\n\nThis is my page.","slug":"my-page"}' \
  https://bul.sh/api/namespaces/myname/pages/publish
```

## For AI Agents

Any AI that can run shell commands can publish. Just tell it:

> Use `node dist/src/cli/main.js publish file.md --api-base https://bul.sh` to publish markdown to a URL.
> Use `node dist/src/cli/main.js list --api-base https://bul.sh` to see published pages.
> Use `cat content.md | node dist/src/cli/main.js publish --slug my-page --namespace <ns> --api-base https://bul.sh` to publish from stdin.

Or add this to your project's `CLAUDE.md` / agent instructions:

```
To share long-form output as a URL, use:
  node dist/src/cli/main.js publish <file.md> --api-base https://bul.sh
The command prints the live URL to stdout.
```

No SDK, no MCP server, no API client — just a shell command.

## Frontmatter

Control page metadata with YAML frontmatter:

```yaml
---
title: My Report
slug: custom-url-slug
description: A short summary for social previews
noindex: false        # default: true (unlisted)
visibility: public    # public | unlisted | private
draft: true           # draft pages are not listed
---

# My Report

Content here...
```

All fields are optional. Title and description are auto-extracted from content if not specified.

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
