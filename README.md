# SolContinuity

Application-layer resilience and censorship-resistance tooling for Solana dApps.

A dApp can use decentralized programs while still depending on one RPC provider, hosted frontend, API, or indexer. SolContinuity makes those dependencies visible and provides a narrow, evidence-oriented path for quorum reads, failover, transaction broadcast, independent confirmation, provider scoring, evidence history, and portable recovery metadata.

## Current implementation

- strict TypeScript multi-RPC client
- provider-aware quorum and failover
- configurable transaction `preflightCommitment`
- per-endpoint latency, value, operator, and error evidence
- multi-route signed transaction broadcast
- independent signature-status verification
- reusable JavaScript quorum-read and signed-broadcast examples
- typed resilience manifest and deterministic audit
- Node.js API and self-hostable technical console
- sanitized blockchain evidence-history endpoint
- Python FastAPI analytics for provider and evidence scoring
- standalone Python evidence-report CLI
- deterministic outage simulator
- CLI audit and endpoint-health commands
- Node, Python, and Playwright tests
- GitHub Actions verification and live Devnet evidence workflows
- threat model, ADR, Figma spec, Canva deck outline, and review prompts

## Install

```bash
npm install
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
```

## Verify

```bash
npm run verify
```

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

To load one or more local evidence artifacts into the Console, provide comma-separated paths relative to the repository root:

```bash
SOLCONTINUITY_ANALYTICS_URL=http://127.0.0.1:8001 \
SOLCONTINUITY_EVIDENCE_PATHS=test-results/live-devnet-evidence.json,examples/evidence/live-devnet-evidence.sample.json \
npm start
```

The Node API exposes sanitized history at `GET /api/evidence/history`. It returns signatures, provider observations, confirmation state, and optional Python assessment, but never returns `transactionBase64`.

## JavaScript examples

Build once, then run a quorum read against the reference Devnet manifest:

```bash
npm run build
node examples/javascript/quorum-read.mjs
```

Broadcast a transaction that was signed outside this example:

```bash
SOLCONTINUITY_SIGNED_TX_BASE64='<pre-signed-base64-transaction>' \
SOLCONTINUITY_PREFLIGHT_COMMITMENT=confirmed \
node examples/javascript/broadcast-signed-transaction.mjs
```

The broadcast example accepts a serialized, pre-signed transaction only. It does not accept or load private keys.

## Python evidence report

Score a machine-readable evidence artifact:

```bash
python scripts/score-evidence.py examples/evidence/live-devnet-evidence.sample.json
```

The report scores provider health, quorum, route coverage, broadcast acceptance, and independent confirmation. Its result is limited to the supplied application-layer evidence.

## CLI

```bash
npm run audit:example
npm run health:example
```

The reference manifest uses public Solana Devnet routes operated by Solana public RPC, OnFinality, and Triton One. Public endpoints can rate-limit or apply access policies, so live evidence preserves route failures rather than hiding them.

## Architecture boundary

SolContinuity improves **application-layer resilience**. It does not alter Solana consensus, guarantee universal transaction inclusion, certify that providers are honest, or prove that censorship is impossible.

## Source layout

```text
src/core/       Runtime, manifest, and audit logic
src/api/        Node API, evidence-history sanitization, and static console host
src/cli/        Command-line interface
src/dashboard/  Self-hostable technical console
src/testing/    Deterministic RPC failure simulator
python/         FastAPI analytics, evidence scoring, and tests
scripts/        Live evidence and report runners
examples/       Resilience manifests, JavaScript examples, and sanitized fixtures
tests/          Node unit and integration tests
e2e/            Playwright browser verification
design/         Figma-ready UI spec and Canva grant-deck outline
docs/           Architecture, ADRs, references, and threat model
prompts/        Founder and product review operating artifacts
```

## Founder gates

Publishing, deployment, spending, grant submission, secrets, live transaction tests, and merge remain explicit founder decisions. No destructive operation is included.
