# Publish It

> `stdout` for the web — one command, one URL, done.

Publish markdown to a stable URL. Built for AI agents, usable by humans.

**Live at [bul.sh](https://bul.sh)**

## Install

```bash
# One-liner (downloads binary)
curl -fsSL https://bul.sh/install | sh

# Or via npm
npm install -g publish-it

# Or from source
git clone https://github.com/Restuta/publish-it.git
cd publish-it && npm install && npm run build && npm link
```

## Quick Start

```bash
# Claim your namespace
pub claim myname --api-base https://bul.sh

# Publish
pub publish notes.md
# → https://bul.sh/myname/notes

# Re-publish (same URL, updated content)
pub publish notes.md

# Pipe from stdin
cat report.md | pub publish --slug weekly-report

# List your pages
pub list

# Delete a page
pub remove weekly-report
```

## Zero-Install (curl)

No CLI needed. Any tool that can run curl can publish:

```bash
# Claim namespace
curl -X POST https://bul.sh/api/namespaces/myname/claim

# Publish raw markdown (one-liner)
curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @file.md https://bul.sh/api/namespaces/myname/pages/publish

# With custom slug
curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @file.md "https://bul.sh/api/namespaces/myname/pages/publish?slug=my-page"

# Or JSON if you prefer
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"markdown": "# Hello\n\nThis is my page."}' \
  https://bul.sh/api/namespaces/myname/pages/publish
```

## For AI Agents

Any AI that can run shell commands can publish. Just tell it:

> Use `pub publish file.md` to publish markdown to a URL.
> Use `pub list` to see published pages.
> Use `cat content.md | pub publish --slug my-page` to publish from stdin.

Or add this to your project's `CLAUDE.md` / agent instructions:

```
To share long-form output as a URL, use:
  pub publish <file.md>
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
PUBLISH: CLI posts markdown → server renders HTML once → stores .md + .html in CDN
READ:    Browser hits URL → CDN serves pre-rendered HTML (no compute)
```

Pages are pre-rendered on publish. Reads are static file serves from Vercel's edge CDN. Zero JS, system fonts, < 20KB per page.

## CLI Reference

```
pub claim <namespace>                          Claim a namespace, get API token
pub publish [file] [--slug <s>] [--namespace <n>]   Publish or update a page
pub list [--namespace <n>]                     List your published pages
pub remove <slug> [--namespace <n>]            Delete a page
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
