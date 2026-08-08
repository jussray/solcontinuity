import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
