#!/usr/bin/env node

const repository = process.env.GITHUB_REPOSITORY || 'jussray/solcontinuity';
const token = process.env.GITHUB_TOKEN || '';
const reportOnly = process.env.SOLCONTINUITY_AUTHORITY_REPORT_ONLY === '1';
const requiredContext = process.env.SOLCONTINUITY_REQUIRED_STATUS_CONTEXT || 'verify';
const apiVersion = '2026-03-10';

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': apiVersion,
  'User-Agent': 'solcontinuity-main-authority-check',
};
if (token) headers.Authorization = `Bearer ${token}`;

async function readJson(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub authority readback failed for ${path}: HTTP ${response.status}`);
  return response.json();
}

function appliesToMain(ruleset) {
  if (ruleset.target !== 'branch' || ruleset.enforcement !== 'active') return false;
  const refName = ruleset.conditions?.ref_name;
  if (!refName) return true;
  const include = Array.isArray(refName.include) ? refName.include : [];
  const exclude = Array.isArray(refName.exclude) ? refName.exclude : [];
  const mainTokens = new Set(['~ALL', '~DEFAULT_BRANCH', 'main', 'refs/heads/main']);
  const included = include.length === 0 || include.some((value) => mainTokens.has(value));
  const excluded = exclude.some((value) => mainTokens.has(value));
  return included && !excluded;
}

function ruleContexts(rule) {
  if (rule?.type !== 'required_status_checks') return [];
  const checks = rule?.parameters?.required_status_checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .map((check) => typeof check === 'string' ? check : check?.context)
    .filter((value) => typeof value === 'string' && value.length > 0);
}

const branch = await readJson('/branches/main');
const rulesetSummaries = await readJson('/rulesets');
const detailedRulesets = [];
for (const summary of Array.isArray(rulesetSummaries) ? rulesetSummaries : []) {
  if (!summary?.id) continue;
  detailedRulesets.push(await readJson(`/rulesets/${summary.id}`));
}

const classicContexts = branch.protection?.required_status_checks?.contexts ?? [];
const classicChecks = branch.protection?.required_status_checks?.checks ?? [];
const classicRequiredContexts = [
  ...classicContexts,
  ...classicChecks.map((check) => check?.context),
].filter((value) => typeof value === 'string' && value.length > 0);
const classicHasRequiredContext = Boolean(branch.protected) && classicRequiredContexts.includes(requiredContext);

const activeMainRulesets = detailedRulesets.filter(appliesToMain);
const rulesetRequiredContexts = activeMainRulesets.flatMap((ruleset) =>
  Array.isArray(ruleset.rules) ? ruleset.rules.flatMap(ruleContexts) : []
);
const uniqueRulesetRequiredContexts = [...new Set(rulesetRequiredContexts)];
const rulesetHasRequiredContext = uniqueRulesetRequiredContexts.includes(requiredContext);

const hasRule = (type) => activeMainRulesets.some((ruleset) =>
  Array.isArray(ruleset.rules) && ruleset.rules.some((rule) => rule?.type === type)
);
const rulesetPullRequest = hasRule('pull_request');
const rulesetDeletionGuard = hasRule('deletion');
const rulesetRewriteGuard = hasRule('non_fast_forward');
const emptyRequiredCheckRules = activeMainRulesets.reduce((count, ruleset) => {
  if (!Array.isArray(ruleset.rules)) return count;
  return count + ruleset.rules.filter((rule) => rule?.type === 'required_status_checks' && ruleContexts(rule).length === 0).length;
}, 0);

const protectedByRequiredChecks = classicHasRequiredContext || rulesetHasRequiredContext;
const providerMergeMembrane =
  rulesetHasRequiredContext &&
  rulesetPullRequest &&
  rulesetDeletionGuard &&
  rulesetRewriteGuard;

const receipt = {
  repository,
  branchProtected: Boolean(branch.protected),
  requiredContext,
  classicRequiredContexts,
  rulesetRequiredContexts: uniqueRulesetRequiredContexts,
  emptyRequiredCheckRules,
  activeMainRulesets: activeMainRulesets.map((ruleset) => ({
    id: ruleset.id,
    name: ruleset.name,
    enforcement: ruleset.enforcement,
    ruleTypes: Array.isArray(ruleset.rules) ? ruleset.rules.map((rule) => rule?.type).filter(Boolean) : [],
    requiredContexts: Array.isArray(ruleset.rules) ? ruleset.rules.flatMap(ruleContexts) : [],
  })),
  protectedByRequiredChecks,
  providerMergeMembrane,
  reportOnly,
};

console.log(JSON.stringify(receipt));

if (!protectedByRequiredChecks && !reportOnly) {
  throw new Error(
    `SolContinuity main does not require the proven exact-head status context "${requiredContext}". ` +
    'An empty required_status_checks rule is not evidence of protection.'
  );
}

if (!providerMergeMembrane && !reportOnly) {
  throw new Error(
    `SolContinuity main does not have the minimum provider merge membrane: active main-applicable pull_request, deletion, non_fast_forward, and named required status check "${requiredContext}".`
  );
}
