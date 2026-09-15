# Architecture

## Product boundary

SolContinuity measures and improves application-layer continuity for applications that depend on multiple network or infrastructure routes.

The core product boundary is platform-neutral: identify the subject being protected, declare independent routes and dependencies, require agreement, preserve evidence, and retain a recovery path.

Solana is the first fully implemented adapter and live evidence environment. Solana-specific transaction broadcast, commitment, signature verification, and Devnet proof remain explicit adapter behavior rather than being treated as universal semantics.

The system does not modify validators, consensus, or external provider behavior.

## Canonical model

A normalized continuity manifest contains:

1. **platform** — the ecosystem or protocol family, such as `solana`, `evm`, or another JSON-RPC platform.
2. **environment** — the deployment environment or network name.
3. **targets** — the programs, contracts, services, or resources whose continuity matters.
4. **routes** — independently operated JSON-RPC endpoints used for reads, failover, and evidence.
5. **dependencies** — required off-route services plus replacement or export paths.
6. **verification** — minimum route agreement and evidence-publication policy.
7. **recovery** — alternate frontend and self-host instructions.

Legacy Solana fields (`network`, `programAddresses`, `rpcEndpoints`, and `minimumRpcAgreement`) are accepted and normalized into this model. They are compatibility aliases, not the future architecture boundary.

## Components

- **TypeScript core:** platform-neutral JSON-RPC quorum reads, provider-aware evidence, manifest parsing, and deterministic continuity audit.
- **Solana adapter behavior:** blockhash health probing, multi-route signed transaction broadcast, and commitment-aware signature verification.
- **Node API:** one HTTP boundary for the console and external integrations. It reuses the typed core rather than duplicating audit logic.
- **Python analytics:** deterministic scoring of supplied provider observations. It produces dimensions and flags, not claims of provider honesty.
- **Console:** a static, self-hostable interface that works in local fallback mode and consumes the Node API when served.
- **Playwright:** verifies the built browser path and preserves screenshot evidence.

## Data flow

1. An application or operator supplies a continuity manifest.
2. The parser normalizes legacy or platform-neutral input into one continuity model.
3. The TypeScript core validates and audits routes, dependencies, targets, evidence, and recovery paths.
4. Runtime observations are collected per route and operator.
5. Python analytics scores availability, operator diversity, latency, and response agreement.
6. Adapter-specific evidence may add platform semantics such as Solana transaction confirmation.
7. The API returns sanitized evidence to the console or integrations.
8. Reports remain exportable so the hosted console is not the only source of truth.

## Adapter rule

A new platform is not called supported merely because generic JSON-RPC requests happen to work. A first-class adapter must define and test its own health semantics, write/broadcast behavior when applicable, independent confirmation rules, evidence shape, recovery path, and failure modes.
