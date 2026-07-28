# Official Solana References

Checked 2026-07-28.

## Frontend SDK direction

Official Solana frontend documentation currently presents `@solana/client`, `@solana/react-hooks`, `@solana/web3-compat`, and the lower-level `@solana/kit`. It marks `@solana/web3.js` as deprecated and recommends the compatibility path for migration.

- https://solana.com/docs/frontend

## JSON-RPC health and verification

The first runtime uses Solana JSON-RPC directly so failure evidence remains explicit and the core does not depend on one provider SDK.

- `getHealth`: https://solana.com/docs/rpc/http/gethealth
- `getTransaction`: https://solana.com/docs/rpc/http/gettransaction

## Solana Pay direction

Official Solana Pay documentation describes the standard as a way to integrate decentralized payments and currently documents `@solana/pay@beta` with `@solana/kit`. ProofRail payment work should use that current stack after the resilience core and live-provider gates are approved.

- https://solana.com/docs/tools/solana-pay
- https://solana.com/docs/tools/solana-pay/quickstart/installation
- https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests

## Design decision

The v0.1 core remains a standards-based JSON-RPC implementation. A later adapter may use the current Solana SDK stack, but must preserve per-provider observations, independent-provider quorum, timeouts, disagreement evidence, and recovery metadata.
