import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../scripts/run-python.mjs", import.meta.url));

function findPython3() {
  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, [
      "-c",
      "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)"
    ]);
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

async function waitForFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test("run-python honors a valid PYTHON_BIN", () => {
  const python = findPython3();
  assert.ok(python, "test environment must provide Python 3");

  const result = spawnSync(process.execPath, [runner, "--version"], {
    env: { ...process.env, PYTHON_BIN: python },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("run-python rejects an invalid explicit PYTHON_BIN", () => {
  const result = spawnSync(process.execPath, [runner, "--version"], {
    env: { ...process.env, PYTHON_BIN: "definitely-not-a-python-command" },
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a usable Python 3 executable/);
});

test("run-python forwards SIGTERM to a long-lived Python child", async () => {
  const python = findPython3();
  assert.ok(python, "test environment must provide Python 3");

  const directory = mkdtempSync(join(tmpdir(), "solcontinuity-python-runner-"));
  const marker = join(directory, "signal");
  const script = [
    "import signal, sys, time",
    "marker = sys.argv[1]",
    "open(marker + '.ready', 'w').write('ready')",
    "def stop(signum, frame):",
    "    open(marker + '.stopped', 'w').write(str(signum))",
    "    raise SystemExit(0)",
    "signal.signal(signal.SIGTERM, stop)",
    "while True:",
    "    time.sleep(0.1)"
  ].join("\n");

  const child = spawn(process.execPath, [runner, "-c", script, marker], {
    env: { ...process.env, PYTHON_BIN: python },
    stdio: "ignore"
  });

  try {
    await waitForFile(`${marker}.ready`);
    child.kill("SIGTERM");
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    assert.deepEqual(exit, { code: null, signal: "SIGTERM" });
    assert.equal(readFileSync(`${marker}.stopped`, "utf8").length > 0, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});
