# Devnet provider selection

SolContinuity's live evidence gate uses three separately operated RPC routes:

1. **Solana public RPC** — the official rate-limited Devnet endpoint.
2. **OnFinality** — a third-party public Solana Devnet endpoint operated by OnFinality.
3. **Triton One** — a third-party public Devnet RPC route operated by Triton One.

The routes are treated as separate providers because they are published and operated by distinct organizations. Different URLs from the same operator would not increase provider quorum.

## Blockchain proof path

The gate proves actual Solana use rather than monitoring alone:

- generate an ephemeral Devnet keypair
- request faucet funding across the configured providers with bounded backoff
- preserve every funding acceptance, timeout, RPC error, and failed confirmation
- require the funding transaction to be confirmed by at least two independent providers
- construct and sign a one-lamport System Program transfer
- broadcast the serialized transaction through every configured RPC route
- preserve every broadcast acceptance, timeout, HTTP failure, RPC error, and disagreement
- require at least two independent providers to report the transfer signature as confirmed
- run the Continuity Console Playwright path even when the blockchain gate fails

## Evidence rules

- Every route is contacted for health, quorum, broadcast, and verification evidence.
- A quorum read must agree across at least two distinct provider names.
- A transaction must be attempted through all configured routes.
- Funding and transfer signatures must each be independently confirmed by at least two providers.
- Timeouts, rate limits, HTTP failures, RPC errors, and disagreements remain in the JSON artifact.
- Provider agreement is evidence of cross-operator consistency for the tested request. It is not proof that providers cannot collude or share hidden infrastructure.

## Credential boundary

The reference manifest contains only credential-free public endpoints. Production endpoints and API keys must be supplied through environment-specific configuration and must never be committed.

## Operational boundary

Public Devnet endpoints and faucets are rate-limited and may fail intermittently. The workflow uses bounded retries and fails closed rather than hiding instability or treating an offline simulation as live blockchain proof.
