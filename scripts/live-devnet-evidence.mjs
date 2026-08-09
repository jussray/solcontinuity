import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import { MultiRpcClient } from "../dist/src/core/multi-rpc-client.js";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const manifestPath = resolve(process.cwd(), process.argv[2] ?? "examples/resilience-manifest.json");
const outputPath = resolve(process.cwd(), "test-results/live-devnet-evidence.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const client = new MultiRpcClient({ endpoints: manifest.rpcEndpoints, defaultTimeoutMs: 8_000 });
const endpointById = new Map(manifest.rpcEndpoints.map((endpoint) => [endpoint.id, endpoint]));
const configuredKeypairJson = process.env.SOLCONTINUITY_DEVNET_KEYPAIR?.trim() ?? "";

const evidence = {
  schemaVersion: "1.1",
  generatedAt: new Date().toISOString(),
  manifest: manifest.name,
  network: manifest.network,
  providerSelection: manifest.rpcEndpoints.map(({ id, provider, url }) => ({ id, provider, url })),
  health: null,
  quorumRead: null,
  funding: {
    mode: null,
    secretConfigured: configuredKeypairJson.length > 0,
    minimumBalanceLamports: 100_000,
    requestedLamports: 2_000_000,
    payer: null,
    balanceObservations: [],
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
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: String(error) };
  }

  const details = {
    name: error.name,
    message: error.message,
    stack: error.stack
  };

  if ("code" in error) {
    details.code = error.code;
  }
  if ("evidence" in error) {
    details.evidence = error.evidence;
  }
  if ("cause" in error && error.cause !== undefined) {
    details.cause = error.cause instanceof Error
      ? { name: error.cause.name, message: error.cause.message }
      : error.cause;
  }

  return details;
}

function independentProviderCount(endpointIds) {
  return new Set(
    endpointIds
      .map((endpointId) => endpointById.get(endpointId)?.provider?.trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

function loadConfiguredPayer() {
  if (!configuredKeypairJson) {
    return null;
  }

  let values;
  try {
    values = JSON.parse(configuredKeypairJson);
  } catch (error) {
    throw new Error(
      `SOLCONTINUITY_DEVNET_KEYPAIR is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (
    !Array.isArray(values) ||
    values.length !== 64 ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new Error("SOLCONTINUITY_DEVNET_KEYPAIR must be a Solana 64-byte secret-key JSON array.");
  }

  return Keypair.fromSecretKey(Uint8Array.from(values));
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

async function observeBalances(publicKey) {
  const observations = [];

  for (const endpoint of manifest.rpcEndpoints) {
    const startedAt = Date.now();
    try {
      const connection = new Connection(endpoint.url, "confirmed");
      const balanceLamports = await connection.getBalance(publicKey, "confirmed");
      observations.push({
        endpointId: endpoint.id,
        provider: endpoint.provider,
        ok: true,
        balanceLamports,
        elapsedMs: Date.now() - startedAt,
        error: null
      });
    } catch (error) {
      observations.push({
        endpointId: endpoint.id,
        provider: endpoint.provider,
        ok: false,
        balanceLamports: null,
        elapsedMs: Date.now() - startedAt,
        error: errorDetails(error)
      });
    }
  }

  evidence.funding.balanceObservations = observations;
  await persist();
  return observations;
}

async function useConfiguredFunding(payer) {
  evidence.funding.mode = "pre-funded-github-actions-secret";
  const observations = await observeBalances(payer.publicKey);
  const usable = observations
    .filter((observation) => observation.ok && observation.balanceLamports >= evidence.funding.minimumBalanceLamports)
    .sort((left, right) => right.balanceLamports - left.balanceLamports)[0];

  if (!usable) {
    throw new Error(
      `Configured Devnet CI wallet ${payer.publicKey.toBase58()} has less than ${evidence.funding.minimumBalanceLamports} lamports on every reachable provider. Fund the public address with Devnet SOL; never commit the private key.`
    );
  }

  const endpoint = endpointById.get(usable.endpointId);
  if (!endpoint) {
    throw new Error(`Configured funding endpoint ${usable.endpointId} is missing from the manifest.`);
  }

  evidence.funding.balanceLamports = usable.balanceLamports;
  await persist();
  return {
    endpointId: endpoint.id,
    provider: endpoint.provider,
    endpointUrl: endpoint.url,
    balanceLamports: usable.balanceLamports
  };
}

async function requestAirdropWithRetries(publicKey, lamports) {
  evidence.funding.mode = "public-rpc-airdrop-fallback";
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

  throw new Error(
    `Unable to fund the ephemeral Devnet payer after ${backoffMs.length} provider rounds. Configure the SOLCONTINUITY_DEVNET_KEYPAIR GitHub Actions secret with a pre-funded Devnet-only wallet for reliable CI.`
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

  evidence.quorumRead = await client.request("getMinimumBalanceForRentExemption", [0], {
    mode: "quorum",
    minimumAgreement: 2,
    minimumProviderAgreement: 2
  });

  const configuredPayer = loadConfiguredPayer();
  const payer = configuredPayer ?? Keypair.generate();
  evidence.funding.payer = payer.publicKey.toBase58();
  await persist();

  const funding = configuredPayer
    ? await useConfiguredFunding(payer)
    : await requestAirdropWithRetries(payer.publicKey, evidence.funding.requestedLamports);
  const connection = new Connection(funding.endpointUrl, "confirmed");
  evidence.funding.balanceLamports = await connection.getBalance(payer.publicKey, "confirmed");

  if (evidence.funding.balanceLamports < evidence.funding.minimumBalanceLamports) {
    throw new Error(
      `Devnet payer balance ${evidence.funding.balanceLamports} is below the required floor ${evidence.funding.minimumBalanceLamports}.`
    );
  }

  const blockhashCommitment = "finalized";
  const latestBlockhash = await connection.getLatestBlockhash(blockhashCommitment);
  const memo = `SolContinuity live Devnet evidence ${evidence.generatedAt}`;
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash
  }).add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf8")
    })
  );
  transaction.sign(payer);
  const transactionBase64 = transaction.serialize().toString("base64");

  evidence.transaction = {
    kind: "memo",
    payer: payer.publicKey.toBase58(),
    memo,
    memoProgramId: MEMO_PROGRAM_ID.toBase58(),
    blockhashCommitment,
    recentBlockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    transactionBase64,
    broadcast: null,
    verification: null
  };
  await persist();

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

  evidence.transaction = {
    ...evidence.transaction,
    broadcast
  };
  await persist();

  const verification = await waitForProviderConfirmation(broadcast.value, 2);
  evidence.transaction = {
    ...evidence.transaction,
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
