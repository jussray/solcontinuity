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

## Verification

The repository command below packs the project, installs the tarball into a temporary unrelated project, imports the SDK, runs a two-provider quorum request with a deterministic mock transport, starts the packaged server, loads the packaged manifest, and serves the packaged Console:

```bash
npm run test:consumer
```

Its machine-readable result is written to `test-results/external-adoption-evidence.json`.

## Truth boundary

This clean-room test proves that the package can be installed and self-hosted outside the repository. It does not prove adoption by an independent human developer, production reliability, provider honesty, or censorship resistance at the Solana consensus layer.
