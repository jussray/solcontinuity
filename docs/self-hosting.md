# Self-hosting SolContinuity

SolContinuity can be installed from a packed release artifact and run without the source repository.

## Package boundary

The package exposes:

- `solcontinuity` for the SDK surface
- `solcontinuity/server` for the Node server factory
- the `solcontinuity` CLI binary
- the built Continuity Console
- the reference resilience manifest

The package intentionally excludes tests, runtime evidence, environment files, and private keys.

## Clean-room install

From a packaged tarball:

```bash
mkdir solcontinuity-consumer
cd solcontinuity-consumer
npm init -y
npm install /absolute/path/to/solcontinuity-0.1.0.tgz
```

Use the SDK:

```js
import { MultiRpcClient } from "solcontinuity";

const client = new MultiRpcClient({
  endpoints: [
    { id: "operator-a", provider: "Operator A", url: "https://rpc-a.example" },
    { id: "operator-b", provider: "Operator B", url: "https://rpc-b.example" }
  ]
});

const result = await client.request("getGenesisHash", [], {
  mode: "quorum",
  minimumAgreement: 2,
  minimumProviderAgreement: 2
});

console.log(result.value, result.evidence);
```

Start the packaged Console programmatically:

```js
import { createSolContinuityServer } from "solcontinuity/server";

const server = createSolContinuityServer();
server.listen(4173, "127.0.0.1", () => {
  console.log("SolContinuity: http://127.0.0.1:4173");
});
```

Or run the packaged server file directly:

```bash
PORT=4173 node node_modules/solcontinuity/dist/src/api/server.js
```

## Optional configuration

- `SOLCONTINUITY_ANALYTICS_URL` points to the Python analytics service.
- `SOLCONTINUITY_EVIDENCE_PATHS` provides comma-separated evidence artifact paths.
- `PORT` changes the Node server port.

Evidence paths are resolved relative to the installed package when the packaged server is used. Do not place private keys or unredacted secrets in evidence files.

## Session and abuse-control deployment boundaries

When `SOLCONTINUITY_CONSOLE_TOKEN` is set, sessions use signed `sc_session` cookies.
With the default factory setup, logout revocation is **process-local**. Restarts and
separate instances do not share that revocation state. Do not represent the
default as multi-instance session security.

For a load-balanced deployment, start the application programmatically with
a shared, durable `SessionRevocationStore` implementation injected into
`createSolContinuityServer({ sessionRevocationStore, requireSharedSessionRevocation: true })`.
The store must accept only SHA-256 cookie digests and their expiry timestamps;
it must return consistent revocation state to all application instances,
prune expired records, protect access to its backing storage, and fail closed
on read/write outages. A common signed-cookie secret is also required across
instances. **No managed shared-store adapter is bundled**. Turning on
`SOLCONTINUITY_REQUIRE_SHARED_SESSIONS=1` without injecting a store intentionally
prevents server startup. A successful in-process shared-object test does not
prove Redis, database, persistence, inter-host consistency, or restart behavior.

A separate process-local rate budget uses the trusted socket address, hashed
with an ephemeral per-process salt, in addition to the per-device fingerprint.
It continues throttling repeated requests when a caller discards a device
cookie or supplies arbitrary `X-Forwarded-For` headers. It does not provide
distributed protection, and clients behind a NAT can share the network budget.
The `networkRateLimit` factory option may tune this tradeoff. Put authenticated
and network-wide distributed throttling at a trusted reverse proxy or shared
rate-limit store before claiming production-grade abuse resistance.

Accept production readiness only after separately exercising real multi-instance
logout, storage outage, restart, proxy IP canonicalization, legitimate NAT traffic,
and a deployed HTTPS session lifecycle without recording session cookie values.

## Verification

The repository command below packs the project, installs the tarball into a temporary unrelated project, imports the SDK, runs a two-provider quorum request with a deterministic mock transport, starts the packaged server, loads the packaged manifest, and serves the packaged Console:

```bash
npm run test:consumer
```

Its machine-readable result is written to `test-results/external-adoption-evidence.json`.

## Truth boundary

This clean-room test proves that the package can be installed and self-hosted outside the repository. It does not prove adoption by an independent human developer, production reliability, provider honesty, or censorship resistance at the Solana consensus layer.
