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
const endpointById = new Map(manifest.rpcEndpoints.map((endpoint) => [endpoint.id, endpoint]));

const evidence = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  manifest: manifest.name,
  network: manifest.network,
  providerSelection: manifest.rpcEndpoints.map(({ id, provider, url }) => ({ id, provider, url })),
  health: null,
  quorumRead: null,
  funding: {
    requestedLamports: 2_000_000,
    payer: null,
    attempts: [],
    signature: null,
    verification: null,
    balanceLamports: null
  },
  transaction: null,
  status: "running",
  error: null
};

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function errorDetails(error) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "UnknownError", message: String(error) };
}

function independentProviderCount(endpointIds) {
  return new Set(
    endpointIds
      .map((endpointId) => endpointById.get(endpointId)?.provider?.trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

async function persist() {
  await mkdir(resolve(process.cwd(), "test-results"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function waitForProviderConfirmation(signature, minimumProviders, timeoutMs = 90_000) {
  const startedAt = Date.now();
  let latest = null;
  let providerAgreementCount = 0;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await client.verifySignature(signature, "confirmed");
    providerAgreementCount = independentProviderCount(latest.confirmedBy);
    if (providerAgreementCount >= minimumProviders) {
      return { ...latest, providerAgreementCount };
    }
    await sleep(2_000);
  }

  throw new Error(
    `Transaction ${signature} was not confirmed by ${minimumProviders} independent providers within ${timeoutMs}ms. Last observation: ${JSON.stringify({ latest, providerAgreementCount })}`
  );
}

async function requestAirdropWithRetries(publicKey, lamports) {
  const backoffMs = [0, 1_500, 3_000, 6_000];

  for (let roundIndex = 0; roundIndex < backoffMs.length; roundIndex += 1) {
    if (backoffMs[roundIndex] > 0) {
      await sleep(backoffMs[roundIndex]);
    }

    for (const endpoint of manifest.rpcEndpoints) {
      const startedAt = Date.now();
      const attempt = {
        round: roundIndex + 1,
        endpointId: endpoint.id,
        provider: endpoint.provider,
        requestedLamports: lamports,
        requestAccepted: false,
        independentlyConfirmed: false,
        elapsedMs: null,
        signature: null,
        requestError: null,
        confirmationError: null
      };

      try {
        const connection = new Connection(endpoint.url, "confirmed");
        attempt.signature = await connection.requestAirdrop(publicKey, lamports);
        attempt.requestAccepted = true;
        attempt.elapsedMs = Date.now() - startedAt;
      } catch (error) {
        attempt.elapsedMs = Date.now() - startedAt;
        attempt.requestError = errorDetails(error);
        evidence.funding.attempts.push(attempt);
        await persist();
        continue;
      }

      evidence.funding.attempts.push(attempt);
      await persist();

      try {
        const verification = await waitForProviderConfirmation(attempt.signature, 2);
        attempt.independentlyConfirmed = true;
        evidence.funding.signature = attempt.signature;
        evidence.funding.verification = verification;
        await persist();
        return {
          signature: attempt.signature,
          endpointId: endpoint.id,
          provider: endpoint.provider,
          endpointUrl: endpoint.url,
          verification
        };
      } catch (error) {
        attempt.confirmationError = errorDetails(error);
        await persist();
      }
    }
  }

  throw new Error(`Unable to fund the ephemeral Devnet payer after ${backoffMs.length} provider rounds.`);
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

  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  evidence.funding.payer = payer.publicKey.toBase58();
  await persist();

  const funding = await requestAirdropWithRetries(payer.publicKey, evidence.funding.requestedLamports);
  const connection = new Connection(funding.endpointUrl, "confirmed");
  evidence.funding.balanceLamports = await connection.getBalance(payer.publicKey, "confirmed");

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
  const transactionBase64 = transaction.serialize().toString("base64");

  const broadcast = await client.broadcastTransaction(transactionBase64, {
    skipPreflight: false,
    maxRetries: 3,
    minimumAcceptances: 1,
    minimumProviderAcceptances: 1
  });
  const attemptedBroadcastProviders = new Set(
    broadcast.evidence.observations.map((observation) => observation.provider.toLowerCase())
  ).size;
  if (attemptedBroadcastProviders < 2) {
    throw new Error("The transaction was not attempted through at least two independent providers.");
  }

  const verification = await waitForProviderConfirmation(broadcast.value, 2);

  evidence.transaction = {
    payer: payer.publicKey.toBase58(),
    recipient: recipient.publicKey.toBase58(),
    lamports: 1,
    recentBlockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    transactionBase64,
    broadcast,
    verification
  };
  evidence.status = "passed";
  await persist();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.status = "failed";
  evidence.error = errorDetails(error);
  await persist();
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
}
