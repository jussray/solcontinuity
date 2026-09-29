#!/usr/bin/env node

const repository = process.env.GITHUB_REPOSITORY || 'jussray/solcontinuity';
const token = process.env.GITHUB_TOKEN || '';
const reportOnly = process.env.SOLCONTINUITY_AUTHORITY_REPORT_ONLY === '1';
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

const branch = await readJson('/branches/main');
const rulesetSummaries = await readJson('/rulesets');
const detailedRulesets = [];
for (const summary of Array.isArray(rulesetSummaries) ? rulesetSummaries : []) {
  if (!summary?.id) continue;
  detailedRulesets.push(await readJson(`/rulesets/${summary.id}`));
}

const classicContexts = branch.protection?.required_status_checks?.contexts ?? [];
const classicChecks = branch.protection?.required_status_checks?.checks ?? [];
const classicRequiredChecks = Boolean(branch.protected) && (classicContexts.length > 0 || classicChecks.length > 0);

const activeMainRulesets = detailedRulesets.filter(appliesToMain);
const hasRule = (type) => activeMainRulesets.some((ruleset) =>
  Array.isArray(ruleset.rules) && ruleset.rules.some((rule) => rule?.type === type)
);

const rulesetRequiredChecks = hasRule('required_status_checks');
const rulesetPullRequest = hasRule('pull_request');
const rulesetDeletionGuard = hasRule('deletion');
const rulesetRewriteGuard = hasRule('non_fast_forward');

const protectedByRequiredChecks = classicRequiredChecks || rulesetRequiredChecks;
const providerMergeMembrane = rulesetRequiredChecks && rulesetPullRequest && rulesetDeletionGuard && rulesetRewriteGuard;

const receipt = {
  repository,
  branchProtected: Boolean(branch.protected),
  classicRequiredChecks,
  activeMainRulesets: activeMainRulesets.map((ruleset) => ({
    id: ruleset.id,
    name: ruleset.name,
    enforcement: ruleset.enforcement,
    ruleTypes: Array.isArray(ruleset.rules) ? ruleset.rules.map((rule) => rule?.type).filter(Boolean) : [],
  })),
  protectedByRequiredChecks,
  providerMergeMembrane,
  reportOnly,
};

console.log(JSON.stringify(receipt));

if (!protectedByRequiredChecks && !reportOnly) {
  throw new Error(
    'SolContinuity main is not protected by provider-enforced required status checks. ' +
    'Repository-side CI can detect drift after a push, but cannot prevent an unverified main mutation without GitHub branch protection or an active main-applicable ruleset.'
  );
}

if (!providerMergeMembrane && !reportOnly) {
  throw new Error(
    'SolContinuity main does not have the minimum provider merge membrane: active main-applicable ruleset with pull_request, deletion, non_fast_forward, and required_status_checks rules.'
  );
}
