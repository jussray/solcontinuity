import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const configured = process.env.PYTHON_BIN?.trim();
const candidates = [...new Set([configured, "python3", "python"].filter(Boolean))];

let selected = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
  if (!probe.error && probe.status === 0) {
    selected = candidate;
    break;
  }
  if (probe.error && probe.error.code !== "ENOENT") {
    console.error(`Unable to probe Python executable '${candidate}': ${probe.error.message}`);
    process.exit(1);
  }
}

if (!selected) {
  console.error(
    "Python 3 is required. Set PYTHON_BIN to a Python 3 executable or install python3/python on PATH."
  );
  process.exit(1);
}

const result = spawnSync(selected, args, { stdio: "inherit" });
if (result.error) {
  console.error(`Failed to run '${selected}': ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
