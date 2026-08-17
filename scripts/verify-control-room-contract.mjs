import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_REPOSITORY = 'jussray/solcontinuity';
const REQUIRED_COMMANDS = [
  '/goalfix',
  '/ultrathink',
  '/truthmode',
  '/confess',
  '/redteam',
  '/lindymode',
  '/ooda',
  '/visualize',
];
const REQUIRED_SCRIPTS = new Map([
  ['typecheck', 'tsc -p tsconfig.json --noEmit'],
  ['test:node', 'npm run build && node --test dist/tests/*.test.js'],
  ['test:runner', 'node --test tests/python-runner.test.mjs'],
  ['test:python', 'node scripts/run-python.mjs -m pytest python/tests -q'],
  ['test:e2e', 'npm run build && node scripts/run-python.mjs e2e/test_dashboard.py'],
  ['test:consumer', 'node scripts/external-consumer-smoke.mjs'],
  ['evidence:devnet', 'npm run build && node scripts/live-devnet-evidence.mjs examples/resilience-manifest.json'],
  ['verify', 'npm run typecheck && npm run test && npm run test:e2e && npm run test:consumer'],
]);
const ALLOWED_KINDS = new Set(['typecheck', 'unit', 'integration', 'e2e', 'contract', 'deployment', 'security', 'build', 'other']);
const ALLOWED_STATUSES = new Set(['active', 'founder-gated', 'missing', 'retired']);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function safePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

const rawManifest = await readFile('control-room.manifest.json', 'utf8');
const manifest = JSON.parse(rawManifest);
const repositoryManifest = JSON.parse(await readFile('.control-room/repository.manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const ciWorkflow = await readFile('.github/workflows/ci.yml', 'utf8');
const controlWorkflow = await readFile('.github/workflows/control-room.yml', 'utf8');
const founderIntelligence = await readFile('AGENTS_FOUNDER_INTELLIGENCE.md', 'utf8');
const errors = [];

if (manifest.schemaVersion !== '1.0') errors.push('control-room schemaVersion must be 1.0');
if (manifest.repository !== EXPECTED_REPOSITORY) errors.push(`control-room repository must be ${EXPECTED_REPOSITORY}`);
if (manifest.portfolioHub !== 'jussray/founder-control-room') errors.push('portfolioHub must be Founder Control Room');
if (manifest.controlRoom?.privateContentAllowed !== false) errors.push('private Control Room content must be denied');
if (manifest.tests?.rawLogsAllowed !== false) errors.push('raw logs must be denied from portfolio aggregation');
if (repositoryManifest.repository?.identifier !== EXPECTED_REPOSITORY) errors.push('federation repository identifier drifted');

for (const command of REQUIRED_COMMANDS) {
  if (!founderIntelligence.includes(command)) errors.push(`Founder Intelligence command missing: ${command}`);
}
if (!founderIntelligence.includes('reasoning, planning, and routing modes only')) {
  errors.push('portable commands must remain reasoning, planning, and routing modes only');
}
if (!founderIntelligence.includes('They never expand execution authority')) {
  errors.push('portable commands must explicitly deny authority expansion');
}
if (!founderIntelligence.includes('Live Solana Devnet resilience evidence remains a separate founder-gated runtime witness')) {
  errors.push('Founder Intelligence must keep live Devnet evidence separately founder-gated');
}
if (!founderIntelligence.includes('the stricter rule wins')) {
  errors.push('Founder Intelligence must preserve stricter SolContinuity authority');
}

for (const [name, command] of REQUIRED_SCRIPTS) {
  if (pkg.scripts?.[name] !== command) errors.push(`package script ${name} drifted`);
}

if (!ciWorkflow.includes("node-version: 24")) errors.push('canonical CI must run Node 24');
if (!ciWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')) errors.push('canonical CI must force JavaScript Actions to Node 24');
if (!ciWorkflow.includes('EXPECTED_HEAD_SHA:')) errors.push('canonical CI must bind an immutable expected head');
if (!controlWorkflow.includes("node-version: '24'")) errors.push('Control Room workflow must run Node 24');
if (!controlWorkflow.includes('python-version: "3.12"')) errors.push('Control Room workflow must pin Python 3.12');
if (!controlWorkflow.includes('npm run verify')) errors.push('Control Room workflow must execute canonical npm verify');
if (!controlWorkflow.includes("'AGENTS_FOUNDER_INTELLIGENCE.md'")) {
  errors.push('Control Room workflow must watch the Founder Intelligence adapter');
}
if (controlWorkflow.includes('npm run evidence:devnet') || ciWorkflow.includes('npm run evidence:devnet')) {
  errors.push('live Devnet evidence must remain outside automatic CI');
}

const catalog = Array.isArray(manifest.tests?.catalog) ? manifest.tests.catalog : [];
if (catalog.length === 0) errors.push('Control Room catalog must not be empty');
const ids = new Set();
for (const entry of catalog) {
  if (!entry?.id || ids.has(entry.id)) errors.push(`invalid or duplicate catalog id: ${String(entry?.id)}`);
  ids.add(entry?.id);
  if (!ALLOWED_KINDS.has(entry?.kind)) errors.push(`${entry?.id}: unsupported kind`);
  if (!ALLOWED_STATUSES.has(entry?.status)) errors.push(`${entry?.id}: unsupported status`);
  if (typeof entry?.required !== 'boolean') errors.push(`${entry?.id}: required must be boolean`);
  if (typeof entry?.command !== 'string' || !entry.command.trim() || entry.command.includes('\n')) errors.push(`${entry?.id}: command must be one line`);
  if (!Array.isArray(entry?.evidencePaths) || entry.evidencePaths.length === 0) errors.push(`${entry?.id}: evidence paths required`);
  for (const evidencePath of Array.isArray(entry?.evidencePaths) ? entry.evidencePaths : []) {
    if (!safePath(evidencePath)) errors.push(`${entry?.id}: unsafe evidence path ${String(evidencePath)}`);
    else if (!(await exists(evidencePath))) errors.push(`${entry?.id}: missing evidence path ${evidencePath}`);
  }
}

const devnet = catalog.find((entry) => entry.id === 'devnet-runtime-evidence');
if (devnet?.status !== 'founder-gated') errors.push('live Devnet evidence must stay founder-gated');

const requiredSignalIds = new Set((repositoryManifest.verification?.requiredSignals ?? []).map((signal) => signal.id));
if (!requiredSignalIds.has('solcontinuity-control-room')) errors.push('federation must require the SolContinuity Control Room signal');
const federatedCatalogIds = new Set((repositoryManifest.verification?.testCatalog ?? []).map((entry) => entry.id));
for (const requiredId of ['typecheck', 'node-tests', 'python-runner-contract', 'python-tests', 'dashboard-e2e', 'external-consumer', 'full-verify']) {
  if (!federatedCatalogIds.has(requiredId)) errors.push(`federation catalog missing ${requiredId}`);
}

if (/(api[_-]?key|private[_-]?key|secret\s*[:=]|token\s*[:=]|sk-[a-z0-9_-]{10,})/i.test(rawManifest)) {
  errors.push('control-room manifest appears to contain secret material');
}

const report = {
  schemaVersion: 1,
  repository: EXPECTED_REPOSITORY,
  status: errors.length === 0 ? 'passed' : 'failed',
  generatedAt: new Date().toISOString(),
  runtime: {node: 24, python: '3.12'},
  jussOsCommands: REQUIRED_COMMANDS,
  catalog: catalog.map((entry) => ({id: entry.id, kind: entry.kind, required: entry.required, status: entry.status})),
  devnetAutomatic: false,
  errors,
};

const output = process.env.CONTROL_ROOM_REPORT_PATH;
if (output) {
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (errors.length > 0) {
  console.error('SolContinuity Control Room contract failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(JSON.stringify(report));
