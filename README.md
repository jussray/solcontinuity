# SolContinuity

Application-layer resilience and censorship-resistance tooling for Solana dApps.

A dApp can use decentralized programs while still depending on one RPC provider, hosted frontend, API, or indexer. SolContinuity makes those dependencies visible and provides a narrow, evidence-oriented path for quorum reads, failover, transaction broadcast, independent confirmation, provider scoring, and portable recovery metadata.

## Current implementation

- strict TypeScript multi-RPC client
- provider-aware quorum and failover
- per-endpoint latency, value, operator, and error evidence
- multi-route signed transaction broadcast
- independent signature-status verification
- typed resilience manifest and deterministic audit
- Node.js API and self-hostable technical console
- Python FastAPI analytics for provider scoring
- deterministic outage simulator
- CLI audit and endpoint-health commands
- Node, Python, and Playwright tests
- GitHub Actions verification workflow
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

## CLI

```bash
npm run audit:example
npm run health:example
```

The example manifest contains placeholder independent-provider URLs. Replace them before a live health check.

## Architecture boundary

SolContinuity improves **application-layer resilience**. It does not alter Solana consensus, guarantee universal transaction inclusion, certify that providers are honest, or prove that censorship is impossible.

## Source layout

```text
src/core/       Runtime, manifest, and audit logic
src/api/        Node API and static console host
src/cli/        Command-line interface
src/dashboard/  Self-hostable technical console
src/testing/    Deterministic RPC failure simulator
python/         FastAPI analytics and tests
tests/          Node unit and integration tests
e2e/            Playwright browser verification
design/         Figma-ready UI spec and Canva grant-deck outline
docs/           Architecture, ADRs, references, and threat model
prompts/        Founder and product review operating artifacts
```

## Founder gates

Publishing, deployment, spending, grant submission, secrets, live transaction tests, and merge remain explicit founder decisions. No destructive operation is included.
