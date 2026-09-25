# SolContinuity

Application-layer continuity and resilience tooling for applications that depend on multiple infrastructure providers.

SolContinuity keeps an application from silently trusting one route, operator, hosted interface, API, or recovery path. The core now models **platform + environment + targets + routes + evidence + recovery** instead of treating Solana as the product boundary.

Solana remains the first fully implemented adapter and live proof environment. The same core manifest and JSON-RPC quorum path can also describe other JSON-RPC ecosystems without pretending Solana-specific transaction semantics are universal.

## Product boundary

**Core:** route diversity, provider-aware quorum, failover, deterministic manifest audit, evidence history, dependency recovery, self-hosting, and portable proof.

**Solana adapter:** `getLatestBlockhash` health checks, signed transaction broadcast, commitment-aware signature verification, Devnet evidence, and Solana-specific recovery proof.

**Not claimed yet:** universal HTTP continuity, automatic EVM transaction semantics, validator/consensus guarantees, or support for every chain. New adapters must preserve the same evidence and recovery contracts before they are called supported.

## Current implementation

- platform-neutral continuity manifest with legacy Solana compatibility
- strict TypeScript multi-route JSON-RPC client
- provider-aware quorum and failover for JSON-RPC reads
- per-route latency, value, operator, and error evidence
- deterministic continuity audit across routes, targets, dependencies, recovery, and evidence publication
- first-class Solana transaction broadcast and independent confirmation
- configurable Solana transaction `preflightCommitment`
- reusable JavaScript quorum-read and signed-broadcast examples
- stable package entrypoint and generated TypeScript declarations
- Node.js API and self-hostable technical console
- device-fingerprint rate limiting and opt-in session authentication for the Console
- sanitized Solana evidence-history endpoint
- Python FastAPI analytics for provider and evidence scoring
- standalone Python evidence-report CLI
- deterministic outage simulator
- CLI continuity audit plus Solana adapter health command
- clean-room tarball install and self-host verification
- Node, Python, Playwright, and external-consumer tests
- GitHub Actions exact-head verification and live Devnet evidence workflows
- threat model, ADR, Figma spec, Canva deck outline, and review prompts

## Manifest compatibility

Legacy Solana manifests remain valid:

```json
{
  "schemaVersion": "1.0",
  "network": "devnet",
  "programAddresses": ["11111111111111111111111111111111"],
  "rpcEndpoints": [{ "id": "rpc-a", "url": "https://example.org" }]
}
```

The parser normalizes them to the platform-neutral model:

```text
platform   -> solana
environment -> devnet
targets     -> program targets
routes      -> rpcEndpoints
```

New manifests should use `platform`, `environment`, `targets`, `routes`, and `verification.minimumRouteAgreement`. See `examples/continuity-manifest.json` for a non-Solana JSON-RPC example.

## Install

Source checkouts use the committed lockfile and do not execute dependency lifecycle scripts during setup:

```bash
npm ci --ignore-scripts --no-audit --no-fund
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium
```

Or run the equivalent one-command setup script:

```bash
./setup.sh
```

## Verify

```bash
npm run verify
```

`npm run verify` includes a clean-room consumer gate. It packs SolContinuity, installs the tarball into a temporary unrelated project, imports the SDK, runs deterministic quorum, starts the packaged Node server, loads the packaged manifest, and serves the packaged Console.

## Run

Terminal 1:

```bash
npm run start:analytics
```

Terminal 2:

```bash
SOLCONTINUITY_ANALYTICS_URL=http://127.0.0.1:8001 npm start
```

Open `http://127.0.0.1:4173`.

To load one or more local Solana evidence artifacts into the Console, provide comma-separated paths relative to the repository root:

```bash
SOLCONTINUITY_ANALYTICS_URL=http://127.0.0.1:8001 \
SOLCONTINUITY_EVIDENCE_PATHS=test-results/live-devnet-evidence.json,examples/evidence/live-devnet-evidence.sample.json \
npm start
```

The Node API exposes sanitized history at `GET /api/evidence/history`. Current transaction-history records are produced by the Solana adapter. They return signatures, provider observations, confirmation state, and optional Python assessment, but never return `transactionBase64`.

## Console security

The Node API server binds to `127.0.0.1` by default and, out of the box, trusts anyone who can reach that loopback port — matching its default "local self-hosted dev tool" threat model. Two independent protections are available for operators who expose the Console beyond loopback:

**Device-fingerprint rate limiting** applies unconditionally, with no configuration required. Every response issues a signed, `HttpOnly`, `SameSite=Strict` `sc_device` cookie; requests are keyed by a hash of that device id plus the client's IP address and user agent, and a token-bucket limiter throttles abusive clients (429 `RATE_LIMITED` with a `Retry-After` header) — more strictly on the expensive `POST /api/audit` and `POST /api/provider-score` endpoints, and most strictly on login attempts.

**Session authentication** is opt-in. Set `SOLCONTINUITY_CONSOLE_TOKEN` to a secret value and every `/api/*` route except `/api/health`, `/api/session/login`, and `/api/session/logout` starts returning `401 AUTHENTICATION_REQUIRED` until the caller presents a valid session:

```bash
curl -c cookies.txt -X POST http://127.0.0.1:4173/api/session/login \
  -H 'content-type: application/json' \
  -d '{"token":"<SOLCONTINUITY_CONSOLE_TOKEN value>"}'

curl -b cookies.txt http://127.0.0.1:4173/api/overview
```

`POST /api/session/login` sets a signed, `HttpOnly`, `SameSite=Strict` `sc_session` cookie (12-hour expiry); `POST /api/session/logout` clears it. The dashboard's own UI does not yet include a login form — this is a backend contract for operators who front the Console with their own auth flow, reverse proxy, or a future login screen.

Cookies are signed with an HMAC secret: set `SOLCONTINUITY_COOKIE_SECRET` to a stable value so sessions and device ids survive process restarts (otherwise a random secret is generated per process start, invalidating existing cookies on every restart). Set `SOLCONTINUITY_COOKIE_SECURE=1` when the Console sits behind a TLS-terminating reverse proxy, to add the `Secure` cookie attribute.

## JSON-RPC core

`MultiRpcClient.request()` is the platform-neutral runtime primitive. It can perform first-success or quorum JSON-RPC reads against independently operated routes and preserve disagreement as evidence.

Solana-specific methods remain explicit adapter capabilities:

- `healthCheck()`
- `broadcastTransaction()`
- `verifySignature()`

They are not evidence that every platform shares Solana transaction or commitment semantics.

## JavaScript examples

Build once, then run a quorum read against the reference Solana Devnet manifest:

```bash
npm run build
node examples/javascript/quorum-read.mjs
```

Broadcast a Solana transaction that was signed outside this example:

```bash
SOLCONTINUITY_SIGNED_TX_BASE64='<pre-signed-base64-transaction>' \
SOLCONTINUITY_PREFLIGHT_COMMITMENT=confirmed \
node examples/javascript/broadcast-signed-transaction.mjs
```

The broadcast example accepts a serialized, pre-signed transaction only. It does not accept or load private keys.

## Python evidence report

Score a machine-readable evidence artifact:

```bash
python3 scripts/score-evidence.py examples/evidence/live-devnet-evidence.sample.json
```

The report scores provider health, quorum, route coverage, broadcast acceptance, and independent confirmation. Its result is limited to the supplied application-layer evidence.

## Package and self-host gate

The repository remains marked `private: true` in `package.json` to prevent accidental registry publication. A local tarball can still be built and verified:

```bash
npm pack
npm run test:consumer
```

The package exposes the SDK at `solcontinuity` and the server factory at `solcontinuity/server`. It includes runtime code, declarations, Console assets, both reference manifests, and self-host documentation. It excludes compiled tests, runtime evidence, environment files, and private keys.

The generic packed package intentionally has no production Node dependencies. The Solana SDK used by the founder-gated Devnet evidence runner remains a repository development dependency instead of being imposed on generic consumers.

See `docs/self-hosting.md` for the clean-room installation and server instructions. The automated gate proves package installability and self-host startup, not adoption by an independent human developer.

## CLI

```bash
npm run audit:example
npm run health:example
```

`audit` is platform-neutral. `health` currently uses the Solana adapter's blockhash probe and refuses non-Solana manifests instead of faking generic support.

The Solana reference manifest uses public Devnet routes operated by separate providers. Public endpoints can rate-limit or apply access policies, so live evidence preserves route failures rather than hiding them.

## Architecture boundary

SolContinuity improves **application-layer continuity**. It does not alter a network's consensus, guarantee universal transaction inclusion, certify that providers are honest, or prove that censorship is impossible.

Solana is the first supported adapter, not the product ceiling.

## Source layout

```text
src/core/       Runtime, platform-neutral manifest, and audit logic
src/api/        Node API, evidence-history sanitization, and static console host
src/cli/        Command-line interface
src/dashboard/  Self-hostable technical console
src/testing/    Deterministic RPC failure simulator
python/         FastAPI analytics, evidence scoring, and tests
scripts/        Solana live evidence, clean-room package, and report runners
examples/       Continuity manifests, JavaScript examples, and sanitized fixtures
tests/          Node unit and integration tests
e2e/            Playwright browser verification
design/         Figma-ready UI spec and Canva grant-deck outline
docs/           Architecture, ADRs, references, self-hosting, and threat model
prompts/        Founder and product review operating artifacts
```

## Founder gates

Registry publishing, deployment, spending, grant submission, secrets, live transaction tests, new platform-adapter claims, and merge remain explicit founder decisions. No destructive operation is included.
