import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const configured = process.env.PYTHON_BIN?.trim();
const candidates = configured ? [configured] : ["python3", "python"];
const python3Probe = [
  "-c",
  "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)"
];

let selected = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, python3Probe, { stdio: "ignore" });
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
  const detail = configured
    ? `PYTHON_BIN='${configured}' is not a usable Python 3 executable.`
    : "No usable Python 3 executable was found on PATH.";
  console.error(`${detail} Install Python 3 or set PYTHON_BIN to a Python 3 executable.`);
  process.exit(1);
}

const result = spawnSync(selected, args, { stdio: "inherit" });
if (result.error) {
  console.error(`Failed to run '${selected}': ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
