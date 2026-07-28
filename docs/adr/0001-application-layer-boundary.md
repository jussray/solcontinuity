# ADR 0001: Keep the first release at the application layer

**Status:** Accepted

## Context

The grant focus includes censorship resistance, but a $10,000 project cannot credibly redesign Solana consensus.

## Decision

Build tools that detect and reduce centralized dependencies in dApps: RPC concentration, missing recovery interfaces, irreplaceable APIs, and unverifiable transaction paths.

## Consequences

- Claims remain measurable and bounded.
- The toolkit can ship incrementally and be reused by existing dApps.
- Validator and protocol-layer censorship resistance remain outside scope.
- Documentation must repeat this boundary to prevent marketing drift.
