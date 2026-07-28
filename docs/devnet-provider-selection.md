# Devnet provider selection

SolContinuity's live evidence gate uses three separately operated RPC routes:

1. **Solana public RPC** — the official rate-limited Devnet endpoint.
2. **OnFinality** — a third-party public Solana Devnet endpoint operated by OnFinality.
3. **Ankr** — a third-party Solana Devnet gateway operated by Ankr.

The routes are treated as separate providers because they are published and operated by distinct organizations. Different URLs from the same operator would not increase provider quorum.

## Evidence rules

- Every route is contacted for health, broadcast, and verification evidence.
- A quorum read must agree across at least two distinct provider names.
- A transaction must be broadcast through all configured routes.
- At least two providers must independently report the signature as confirmed.
- Timeouts, HTTP failures, RPC errors, and disagreements remain in the JSON artifact.
- Provider agreement is evidence of cross-operator consistency for the tested request. It is not proof that providers cannot collude or share hidden infrastructure.

## Credential boundary

The reference manifest contains only credential-free public endpoints. Production endpoints and API keys must be supplied through environment-specific configuration and must never be committed.
