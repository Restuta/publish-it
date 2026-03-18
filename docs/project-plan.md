# Publish-It — Project Plan

> **`stdout` for the web** — one command, one URL, done.

A minimal CLI + service that takes markdown and publishes it to a stable URL. Built for AI agents, used by humans. Extreme minimalism, speed, simplicity — like [[telegra.ph]] but for the terminal era.

**MVP scope**: personal publishing endpoint for the builder + a few power users. Design constraint: keep CLI/API portable for future hosting. Non-goal for MVP: polished multi-user public hosting business.

## Why Build This

- JotBird exists but: 10 doc free limit, 30-day link expiry, $29/yr for permanence, not self-owned infra
- Telegra.ph: no real markdown, no CLI, Telegram-ecosystem locked
- Rentry.co: close but no OG tags, no frontmatter, no versioning, not yours
- **If you can one-shot it, why pay?** Own your publishing infra, customize freely

## Philosophy

1. **One command** — `pub publish note.md` → URL. That's it.
2. **Stable URLs** — published once, lives forever (or until you delete it)
3. **Re-publish** — edit locally, run again, same URL updates
4. **AI-native** — API-first, pipe-friendly, zero browser requirement. CLI + HTTP API covers everything; MCP/skills are just wrappers if needed later
5. **Extreme minimalism** — the [[telegra.ph]] way. No bloat. No features you don't use.

## Core Features (v0.1 — MVP)

### CLI
- `pub claim <namespace>` — claim your namespace, get API token
- `pub publish <file.md>` — publish or update markdown (idempotent — first call creates, subsequent calls update same URL)
- `pub publish <file.md> --slug custom-name` — custom URL slug
- `pub list` — show your published pages
- `pub remove <slug>` — delete a page
- Pipe support: `cat report.md | pub publish`

### Service
- **URL format**: `pub.domain/namespace/slug`
- Clean markdown rendering (GFM + syntax highlighting). Math/Mermaid deferred — add when requested.
- Frontmatter contract: `title`, `slug`, `draft`, `noindex`, `visibility` → parsed for OG tags and page metadata
- `noindex` by default (opt-in to search indexing via frontmatter)
- Sub-second response times

### Auth
- [[telegra.ph]]-model: claim namespace → get token → store in `~/.config/pub/config.json`
- Token hashed server-side (SHA-256)
- No OAuth, no email, no browser needed
- Token rotation via `pub token rotate`

## Architecture

**Pre-render on publish, serve static from CDN.** Rendering cost is paid once by the publisher, never by the reader.

```
PUBLISH FLOW (function invocation):
CLI or curl
  ↓ HTTP POST with Bearer token + markdown body
Edge Function (Hono)
  ↓ remark/rehype pipeline renders markdown → HTML
  ↓ Stores raw .md + pre-rendered .html to public CDN-backed storage
  ↓ Updates metadata in KV
Storage:
  - KV: namespace→token_hash, page_id→metadata, slug→page_id lookups
  - Object storage (R2/Blob): raw markdown + pre-rendered HTML

READ FLOW (zero compute — pure CDN):
Reader hits URL → CDN serves pre-rendered .html directly from object storage
  No function invocation. No compute. Just a static file from the edge.
  Target: < 30ms TTFB globally, < 20KB page weight, effectively free at any scale.
```

**Implementation note (2026-03-19):** current production uses a private Blob store for metadata and a public Blob store for content. The pure CDN read path and KV metadata split in the diagram remain the target architecture, but the deployed app still serves reads through Hono while storing published content in Blob.

### Why This Stack
- **Vercel**: free tier generous, edge CDN fast, blob storage simple
- **Hono**: minimal framework, runs on edge, ~14KB
- **Node 22 + TypeScript**: current implementation target, portable between local dev and Vercel-style hosting. Bun packaging can be added later if single-binary distribution matters.
- **remark/rehype**: same pipeline Quartz uses, handles GFM + Obsidian-flavored MD
- No database needed for MVP — KV + Blob is enough
- **curl as first-class client**: `curl -X POST --data-binary @file.md` — zero install publishing

### Why Pre-render (not render-on-read)
- Read path is a static file serve — as fast as Telegraph or faster
- No cold starts, no compute on read, no cache invalidation complexity
- Page weight stays minimal: only include syntax highlight CSS if page has code, KaTeX only if page has math
- Zero JS, zero external requests — just HTML + inlined CSS
- **System fonts only**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` — no Google Fonts, no font files, no extra HTTP requests. Mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`

## Rendering Pipeline (runs once at publish time)

```
Markdown (raw)
  → remark-parse (AST)
  → remark-gfm (tables, strikethrough, task lists)
  → remark-frontmatter (YAML extraction → OG tags + page metadata)
  → rehype (HTML AST)
  → rehype-highlight (syntax highlighting) — only if code blocks detected
  → rehype-sanitize (XSS prevention)
  → HTML string
  → Wrap in minimal template (< 5KB CSS, conditional includes)
  → Store as .html blob (this is what readers get)
```

## URL Scheme

```
pub.domain/                      → landing page (minimal)
pub.domain/namespace/            → namespace index (list of pages)
pub.domain/namespace/slug        → published page
pub.domain/namespace/slug?raw    → raw markdown
pub.domain/namespace/slug?v=2    → specific version (future)
```

## Data Model (MVP)

Each page has an internal `page_id` (UUID) that users never see. The slug is the public URL. This separation is cheap now and enables renames/redirects/versioning later without breaking URLs.

```
KV keys:
  ns:{namespace}                    → { token_hash, created_at, last_publish_at }
  page:{page_id}                    → { slug, namespace, title, created_at, updated_at, blob_key, views }
  lookup:{namespace}/{slug}         → page_id

Blob:
  {page_id}.md                      → raw markdown content
  {page_id}.html                    → pre-rendered HTML (what readers get)

Local .pub mapping:
  { "report.md": { "slug": "quarterly-report", "page_id": "a1b2c3..." } }
```

**Future extensions (zero-cost to add later):**
- Renames: `redirect:{namespace}/{old-slug} → page_id` + update lookup key
- Revisions: `rev:{page_id}:v{n} → { blob_key, published_at }` + `current_version` field
- Graduate to Postgres when KV queries become painful (listing, search, etc.)

## Milestones

### M0: Spike (1 day)
- [ ] Vercel project + domain setup
- [x] Single Hono publish route: POST markdown → pre-render HTML → store raw markdown + pre-rendered HTML → return URL
- [x] Single Hono read route: GET URL → fetch pre-rendered HTML → serve it (no rendering on read)
- [x] Auth path implemented locally (namespace claiming shipped earlier than originally planned)
- [x] **Goal**: local publish flow produces working URLs with pre-rendered HTML

**Current note:** deployment is live on Vercel and aliased to `bul.sh`. The local and production publish flows are both verified.

### M1: CLI + Auth (2-3 days)
- [x] `pub claim`, `pub publish` (idempotent create/update), `pub list`, `pub remove`
- [x] Namespace claiming with token generation
- [x] Token storage in `~/.config/pub/config.json`
- [x] `.pub` mapping file (like JotBird's `.jotbird`) for file→slug+page_id tracking
- [x] Pipe support (`cat file.md | pub publish`)
- [x] **Goal**: full publish/delete flow works (publish is idempotent — handles both create and update)

### M2: Polish Rendering (1-2 days)
- [x] Full remark/rehype pipeline with GFM + syntax highlighting (math/Mermaid deferred)
- [x] Minimal CSS theme (< 5KB, dark/light, responsive)
- [x] Frontmatter → OG meta tags
- [x] Favicon
- [x] **Goal**: published pages look clean and professional

### M3: Nice-to-Haves (ongoing)
- [ ] `--watch` mode (re-publish on file save)
- [ ] Math/KaTeX + Mermaid rendering (add when requested)
- [ ] Page versioning (keep history, show diffs) — data model already supports this
- [ ] Page renames with redirects — data model already supports this
- [ ] View count analytics
- [ ] Page collections with auto-generated index
- [ ] Expiring pages (TTL)
- [ ] Custom domains (namespace.pub.domain)
- [ ] Web editor (CodeMirror with markdown + live preview)
- [ ] Batch publish API
- [ ] MCP server (if demand exists)

## Competitive Edge Over JotBird

| Feature | JotBird | Publish-It |
|---------|---------|------------|
| Free docs | 10 | Unlimited (own infra) |
| Link expiry (free) | 30 days | Never |
| Permanent links | $29/yr | Free |
| Custom rendering | No | Full control |
| Self-owned infra | No | Yes |
| MCP server | Yes | Yes (M3) |
| Pipe support | Yes | Yes |
| Watch mode | No | Yes (M3) |
| Page versioning | No | Yes (M3) |
| Web editor | No | Yes (M3) |
| Open source | CLI only | Fully open |

## Things to Decide

- [ ] **Name**: `pub`? `md.pub`? `mdpost`? `pushmd`? Need a good domain.
- [ ] **Free tier limits**: unlimited pages? Rate limit only? Storage cap?
- [ ] **Subdomain vs path**: `namespace.domain` vs `domain/namespace` — start with path, add subdomain later?
- [ ] **Markdown flavor**: strict GFM or also support Obsidian-flavored ([[wikilinks]], ==highlights==, callouts)?
- [ ] **Default visibility**: unlisted (noindex) or public?

## Links & References

- [[jotbird-analysis]] — competitive analysis of JotBird
- [[telegraph-api-notes]] — how Telegraph handles auth and editing
- Quartz source (remark/rehype pipeline): github.com/jackyzha0/quartz
- Prose.sh (SSH publishing, OSS): github.com/picosh/pico
- Rentry CLI: github.com/radude/rentry
