# Progress

## Milestone Status
- M0 Spike: complete
- M1 CLI + Auth: complete
- M2 Polish Rendering: complete

## Log
- 2026-03-18: Repository scaffold initialized. Establishing rules, toolchain, and first vertical slice structure.
- 2026-03-18: Implemented a working local MVP: Hono service, file-backed store, shared contract layer, CLI (`claim`, `publish`, `list`, `remove`), pre-rendered HTML output, and `.pub` local page mapping.
- 2026-03-18: Verified with `npm run verify` after adding unit tests plus live integration tests that run the real CLI against a local server.
- 2026-03-19: Attached `bul.sh` to the Vercel project under `anton-vy-projects/publish-it`.
- 2026-03-19: Added a Blob-backed production repository and a root `server.ts` Vercel entrypoint while keeping file-backed local tests intact.
- 2026-03-19: Provisioned separate public and private Blob stores for production content and metadata.
- 2026-03-19: Deployed production successfully and verified the live domain with a real smoke test: claim -> publish -> HTML read -> raw read -> list -> delete on `https://bul.sh`.
- 2026-03-19: Investigated true custom-domain external rewrites on Vercel. Redirects propagate to `bul.sh`, but rewrite routes did not behave as required on the custom domain.
- 2026-03-19: Adopted the pragmatic Vercel production read path: serve pre-rendered HTML through Hono with aggressive edge-cache headers so subsequent reads are CDN hits while content remains stored in Blob.
- 2026-03-20: Added a concrete cost-control and anti-abuse implementation plan to the project plan so hosted usage can be hardened later without redesigning the product.
- 2026-03-20: Implemented first-pass hosted abuse controls in the service layer: reserved namespaces, markdown size caps, claim and publish rate limits, and lazy reclaim of empty stale namespaces.
- 2026-03-20: Added automated coverage for the abuse controls through integration tests on the HTTP app.
