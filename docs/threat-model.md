# Threat Model

## Protected properties

- Users can discover at least one available RPC path.
- Security-sensitive reads are not accepted from a lone endpoint when quorum is configured.
- Signed transactions can be submitted through more than one route.
- Confirmation evidence identifies which endpoints agreed, rejected, failed, or remained pending.
- A recovery interface can be independently deployed from public source and a portable manifest.

## In-scope threats

- RPC outage or timeout
- RPC response disagreement
- one provider controlling multiple configured endpoints
- primary frontend removal
- required private API failure
- stale or unavailable indexer
- misleading resilience claims

## Out of scope for v0.1

- Solana consensus safety or validator behavior
- malicious wallet software
- compromised signing keys
- smart-contract vulnerabilities
- endpoint collusion beyond observable disagreement
- network-wide partition
- legal guarantees of access

## Red-team tests

1. One endpoint returns HTTP 503.
2. Three endpoints return three different values.
3. Two endpoints agree and one lies.
4. All endpoint URLs belong to one provider.
5. The primary frontend disappears.
6. A required private API has no replacement.
7. The configured quorum exceeds endpoint count.
8. Confirmation status is pending or rejected on some endpoints.
