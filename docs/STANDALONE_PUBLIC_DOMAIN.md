# SOL standalone public domain

Deployed 2026-10-22: `sol.foundercontrolroom.org` uses a dedicated Cloudflare Worker named `solcontinuity-public-site`, on route `sol.foundercontrolroom.org/*`. Only the SOL-owned public HTML and CSS are served. All other paths return HTTP 404 without proxying to FCR, including `/admin` and `/api/*`.

Original source blobs from `jussray/solcontinuity` main: `index.html` 3811b8d7adf36e247012f23c48129ee510691d18; `site.css` 1def14cac00cdfe8c9d52c8d389a9d14a2cd3bd6. This revision intentionally excludes the work-in-review styling changes in SOL PR #42; update the embedded Worker after reviewed source changes.

SOL and FCR are separate products. `founder-control-room` Cloudflare Pages previously served `sol.foundercontrolroom.org` due to the existing Pages custom-domain mapping and proxied DNS record. The new Worker route now takes precedence without deleting those records. This is a transitional configuration and should be reconciled once the SOL-only deployment is fully independent.

Anonymous-browser verification: `/`, `/?utm_source=test` and `/index.html` show 'SolContinuity: application-layer continuity'; `/site.css` contains the SOL stylesheet; `/api/overview` and `/admin` yield nonprivate not-found responses. No operational Console, live API or authentication bypass was introduced.

SOL Console: remains self-hosted, with separate Node API and optional session authentication, not served from the public Worker. A future deployed Console requires explicit production infrastructure and independent server-side authorization proof.

Test: `node --test tests/front-door.test.mjs`.
Manual deployment after code review: `npx wrangler deploy --config wrangler.front-door.jsonc`.
Rollback: revert only `sol.foundercontrolroom.org/*` route; note that rollback currently exposes the incorrect FCR Pages page and is not a desired steady state. Do not delete or disable FCR Access, Pages, or authentication settings.
