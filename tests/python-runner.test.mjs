import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const runner = new URL("../scripts/run-python.mjs", import.meta.url);

test("run-python honors PYTHON_BIN", () => {
  const result = spawnSync(process.execPath, [runner.pathname, "--version"], {
    env: { ...process.env, PYTHON_BIN: process.env.PYTHON_BIN || "python3" },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
