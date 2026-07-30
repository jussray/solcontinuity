import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MultiRpcClient } from "../../dist/src/core/multi-rpc-client.js";

const commitments = new Set(["processed", "confirmed", "finalized"]);
const transactionBase64 = process.env.SOLCONTINUITY_SIGNED_TX_BASE64?.trim() ?? "";
const preflightCommitment = process.env.SOLCONTINUITY_PREFLIGHT_COMMITMENT?.trim() || "confirmed";

if (!transactionBase64) {
  throw new Error("Set SOLCONTINUITY_SIGNED_TX_BASE64 to a pre-signed Solana transaction. Private keys are not accepted by this example.");
}
if (!commitments.has(preflightCommitment)) {
  throw new Error("SOLCONTINUITY_PREFLIGHT_COMMITMENT must be processed, confirmed, or finalized.");
}

const manifestPath = resolve(process.cwd(), process.argv[2] ?? "examples/resilience-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const client = new MultiRpcClient({ endpoints: manifest.rpcEndpoints });
const broadcast = await client.broadcastTransaction(transactionBase64, {
  preflightCommitment,
  minimumAcceptances: 1,
  minimumProviderAcceptances: 1
});
const verification = await client.verifySignature(broadcast.value, manifest.verification.commitment);

console.log(JSON.stringify({
  manifest: manifest.name,
  network: manifest.network,
  preflightCommitment,
  broadcast,
  verification
}, null, 2));
