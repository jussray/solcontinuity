# SOL standalone public domain

Deployed 2026-10-22: `sol.foundercontrolroom.org` uses a dedicated Cloudflare Worker named `solcontinuity-public-site`, on route `sol.foundercontrolroom.org/*`. Only the SOL-owned public HTML and CSS are served. All other paths return HTTP 404 without proxying to FCR, including `/admin` and `/api/*`.

Original source blobs from `jussray/solcontinuity` main: `index.html` 3811b8d7adf36e247012f23c48129ee510691d18; `site.css` 1def14cac00cdfe8c9d52c8d389a9d14a2cd3bd6. This revision intentionally excludes the work-in-review styling changes in SOL PR #42; update the embedded Worker after reviewed source changes.

Revision 2026-11-12 (founder implant order): the Worker now embeds the reviewed blueprint triptych front door. Served sources from `jussray/solcontinuity`: `index.html` 3ed215e7759fd541d9e42cd65501488e144bde05 (landing, at `/` and `/index.html`); `signin.html` bd456ceebc4db86e731816807ce21b81cfa3c8eb (Welcome Back); `signup.html` b5eaadfe2e73150c55be65a2f3372cf05557cd03 (Create Account); `evidence.html` 3811b8d7adf36e247012f23c48129ee510691d18 (the continuity page, formerly the root, now at `/evidence.html`); `sol.css` a90e9c97649a252db7d58ba5ca0a3437c2fb47b0; `site.css` 1def14cac00cdfe8c9d52c8d389a9d14a2cd3bd6 (unchanged). The auth panels remain static previews that submit nothing; no account backend is served from this Worker.

SOL and FCR are separate products. `founder-control-room` Cloudflare Pages previously served `sol.foundercontrolroom.org` due to the existing Pages custom-domain mapping and proxied DNS record. The new Worker route now takes precedence without deleting those records. This is a transitional configuration and should be reconciled once the SOL-only deployment is fully independent.

Anonymous-browser verification: `/`, `/?utm_source=test` and `/index.html` show the triptych landing ('Your future remembers where you left off.'); `/signin.html` shows 'Welcome Back'; `/signup.html` shows 'Create your account'; `/evidence.html` shows 'SolContinuity: application-layer continuity'; `/sol.css` and `/site.css` contain the SOL stylesheets; `/api/overview` and `/admin` yield nonprivate not-found responses. No operational Console, live API or authentication bypass was introduced.

SOL Console: remains self-hosted, with separate Node API and optional session authentication, not served from the public Worker. A future deployed Console requires explicit production infrastructure and independent server-side authorization proof.

Test: `node --test tests/front-door.test.mjs`.
Manual deployment after code review: `npx wrangler deploy --config wrangler.front-door.jsonc`.
Rollback: revert only `sol.foundercontrolroom.org/*` route; note that rollback currently exposes the incorrect FCR Pages page and is not a desired steady state. Do not delete or disable FCR Access, Pages, or authentication settings.
