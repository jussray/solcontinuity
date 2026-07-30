import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MultiRpcClient } from "../../dist/src/core/multi-rpc-client.js";

const manifestPath = resolve(process.cwd(), process.argv[2] ?? "examples/resilience-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const client = new MultiRpcClient({ endpoints: manifest.rpcEndpoints });

const health = await client.healthCheck();
const genesisHash = await client.request("getGenesisHash", [], {
  mode: "quorum",
  minimumAgreement: manifest.verification.minimumRpcAgreement,
  minimumProviderAgreement: 2
});

console.log(JSON.stringify({
  manifest: manifest.name,
  network: manifest.network,
  health,
  genesisHash
}, null, 2));
