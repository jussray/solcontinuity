#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditManifest } from "../core/audit.js";
import { ManifestValidationError } from "../core/errors.js";
import { parseManifest } from "../core/manifest.js";
import { MultiRpcClient } from "../core/multi-rpc-client.js";

async function loadManifest(path: string) {
  const absolute = resolve(process.cwd(), path);
  const raw = await readFile(absolute, "utf8");
  return parseManifest(JSON.parse(raw) as unknown);
}

function printUsage(): void {
  console.log(`solcontinuity <command> <manifest>\n\nCommands:\n  audit   Audit declared resilience and recovery paths\n  health  Check RPC health and confirmed slots\n`);
}

async function main(): Promise<void> {
  const [, , command, manifestPath] = process.argv;
  if (!command || !manifestPath || !["audit", "health"].includes(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const manifest = await loadManifest(manifestPath);

  if (command === "audit") {
    console.log(JSON.stringify(auditManifest(manifest), null, 2));
    return;
  }

  const client = new MultiRpcClient({ endpoints: manifest.rpcEndpoints });
  const health = await client.healthCheck();
  console.log(JSON.stringify({ manifest: manifest.name, network: manifest.network, health }, null, 2));
}

main().catch((error: unknown) => {
  if (error instanceof ManifestValidationError) {
    console.error(error.message);
    for (const issue of error.issues) {
      console.error(`- ${issue}`);
    }
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
});
