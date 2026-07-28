import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import { MultiRpcClient } from "../dist/src/core/multi-rpc-client.js";

const manifestPath = resolve(process.cwd(), process.argv[2] ?? "examples/resilience-manifest.json");
const outputPath = resolve(process.cwd(), "test-results/live-devnet-evidence.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const client = new MultiRpcClient({ endpoints: manifest.rpcEndpoints, defaultTimeoutMs: 8_000 });

const evidence = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  manifest: manifest.name,
  network: manifest.network,
  providerSelection: manifest.rpcEndpoints.map(({ id, provider, url }) => ({ id, provider, url })),
  health: null,
  quorumRead: null,
  transaction: null,
  status: "running",
  error: null
};

async function persist() {
  await mkdir(resolve(process.cwd(), "test-results"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function waitForProviderConfirmation(signature, minimumProviders, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await client.verifySignature(signature, "confirmed");
    if (latest.confirmedBy.length >= minimumProviders) {
      return latest;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }

  throw new Error(
    `Transaction ${signature} was not confirmed by ${minimumProviders} providers within ${timeoutMs}ms. Last observation: ${JSON.stringify(latest)}`
  );
}

try {
  evidence.health = await client.healthCheck();

  const healthyProviders = new Set(
    evidence.health.filter((item) => item.healthy).map((item) => item.provider.toLowerCase())
  );
  if (healthyProviders.size < 2) {
    throw new Error(`Fewer than two independent providers are healthy: ${JSON.stringify(evidence.health)}`);
  }

  evidence.quorumRead = await client.request("getGenesisHash", [], {
    mode: "quorum",
    minimumAgreement: 2,
    minimumProviderAgreement: 2
  });

  const fundingEndpoint = manifest.rpcEndpoints.find((endpoint) => endpoint.id === "solana-public-devnet");
  if (!fundingEndpoint) {
    throw new Error("The Solana public Devnet endpoint is required for the ephemeral faucet-funded transaction.");
  }

  const connection = new Connection(fundingEndpoint.url, "confirmed");
  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  const airdropSignature = await connection.requestAirdrop(payer.publicKey, 10_000_000);
  await connection.confirmTransaction(airdropSignature, "confirmed");

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1
    })
  );
  transaction.sign(payer);

  const broadcast = await client.broadcastTransaction(transaction.serialize().toString("base64"), {
    skipPreflight: false,
    maxRetries: 3,
    minimumAcceptances: 1,
    minimumProviderAcceptances: 1
  });
  const verification = await waitForProviderConfirmation(broadcast.value, 2);

  evidence.transaction = {
    payer: payer.publicKey.toBase58(),
    recipient: recipient.publicKey.toBase58(),
    lamports: 1,
    airdropSignature,
    broadcast,
    verification
  };
  evidence.status = "passed";
  await persist();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  await persist();
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
}
