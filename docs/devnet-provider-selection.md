# Devnet provider selection

SolContinuity's live evidence gate uses four separately operated RPC routes:

1. **Solana public RPC**: the official rate-limited Devnet endpoint.
2. **Ankr**: a third-party Solana Devnet endpoint listed by Solana's RPC infrastructure directory.
3. **OnFinality**: a third-party public Solana Devnet endpoint operated by OnFinality.
4. **Triton One**: a third-party public Devnet RPC route operated by Triton One.

The routes are treated as separate providers because they are published and operated by distinct organizations. Different URLs from the same operator would not increase provider quorum.

## Blockchain proof path

The gate proves actual Solana use rather than monitoring alone:

- load a Devnet-only fee payer from the protected `SOLCONTINUITY_DEVNET_KEYPAIR` GitHub Actions secret
- verify its public balance without publishing the private key
- acquire a finalized blockhash that survives cross-provider preflight
- construct and sign a Memo-program transaction containing a timestamped SolContinuity evidence marker
- broadcast the serialized transaction through every configured RPC route
- preserve every broadcast acceptance, timeout, HTTP failure, RPC error, and disagreement
- require at least two independent providers to report the transaction signature as confirmed
- run the Continuity Console Playwright path even when the blockchain gate fails

When the protected key is not configured, the runner attempts bounded public RPC airdrops only as a development fallback. Public Devnet faucets are rate-limited and are not considered a reliable CI funding strategy.

## GitHub Actions wallet setup

1. Generate a Solana keypair dedicated to Devnet CI only.
2. Add the complete 64-byte keypair JSON array as the repository Actions secret `SOLCONTINUITY_DEVNET_KEYPAIR`.
3. Fund the corresponding public address with Devnet SOL only.
4. Keep at least `100000` lamports available so the evidence workflow can pay transaction fees.
5. Never commit the keypair, print it in logs, reuse it on mainnet, or send real SOL to it.

The workflow publishes only the public address, observed balance, serialized signed transaction, provider observations, Memo text, and transaction signature.

## Evidence rules

- Every route is contacted for health, quorum, broadcast, and verification evidence.
- A quorum read must agree across at least two distinct provider names.
- A transaction must be attempted through all configured routes.
- The transaction signature must be independently confirmed by at least two providers.
- Timeouts, rate limits, HTTP failures, RPC errors, and disagreements remain in the JSON artifact.
- Provider agreement is evidence of cross-operator consistency for the tested request. It is not proof that providers cannot collude or share hidden infrastructure.

## Credential boundary

No key, token, seed, or private endpoint is committed to the repository. Production endpoints and API keys must be supplied through environment-specific configuration.

## Operational boundary

Public Devnet endpoints may enforce IP policies or rate limits. A route can therefore appear as pending or blocked while two independent routes still satisfy the evidence threshold. The workflow fails closed when the required independent evidence is absent rather than treating an offline simulation as live blockchain proof.
