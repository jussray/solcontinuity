# Architecture

## Product boundary

SolContinuity measures and improves application-layer resilience for Solana dApps. The system does not modify validators or consensus.

## Components

- **TypeScript core:** quorum reads, provider-aware evidence, transaction broadcast, signature verification, manifest parsing, and deterministic audit.
- **Node API:** one HTTP boundary for the console and external integrations. It reuses the typed core rather than duplicating audit logic.
- **Python analytics:** deterministic scoring of supplied provider observations. It produces dimensions and flags, not claims of provider honesty.
- **Console:** a static, self-hostable interface that works in local fallback mode and consumes the Node API when served.
- **Playwright:** verifies the built browser path and preserves screenshot evidence.

## Data flow

1. A dApp or operator supplies a resilience manifest.
2. The TypeScript core validates and audits declared dependencies.
3. Runtime observations are collected per endpoint and operator.
4. Python analytics scores availability, operator diversity, latency, and response agreement.
5. The API returns evidence to the console or integrations.
6. Reports remain exportable so the hosted console is not the only source of truth.
