import type { AuditFinding, DappManifest, ManifestAuditReport, RiskSeverity } from "./types.js";

interface CheckResult {
  readonly passed: boolean;
  readonly finding?: AuditFinding;
}

const severityPenalty: Readonly<Record<RiskSeverity, number>> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
  info: 0
};

function finding(
  id: string,
  severity: RiskSeverity,
  title: string,
  evidence: string,
  recommendation: string
): CheckResult {
  return { passed: false, finding: { id, severity, title, evidence, recommendation } };
}

function pass(): CheckResult {
  return { passed: true };
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export function auditManifest(manifest: DappManifest, generatedAt = new Date()): ManifestAuditReport {
  const providers = manifest.rpcEndpoints.map((endpoint) => endpoint.provider ?? hostname(endpoint.url));
  const uniqueProviders = new Set(providers.map((provider) => provider.toLowerCase()));
  const requiredDependencies = manifest.dependencies.filter((dependency) => dependency.required);
  const irreplaceableDependencies = requiredDependencies.filter((dependency) => !dependency.replacement);

  const checks: CheckResult[] = [
    manifest.rpcEndpoints.length >= 3
      ? pass()
      : finding(
          "rpc-count",
          "high",
          "Insufficient RPC endpoint diversity",
          `Manifest declares ${manifest.rpcEndpoints.length} RPC endpoint(s).`,
          "Declare at least three independently operated endpoints for meaningful failover and comparison."
        ),
    uniqueProviders.size >= 2
      ? pass()
      : finding(
          "rpc-provider-concentration",
          "critical",
          "RPC endpoints share one provider",
          `Detected provider set: ${[...uniqueProviders].join(", ") || "none"}.`,
          "Use endpoints controlled by at least two independent operators. Multiple URLs from one operator do not remove operator risk."
        ),
    manifest.verification.minimumRpcAgreement >= 2
      ? pass()
      : finding(
          "minimum-agreement",
          "high",
          "Single-source verification is allowed",
          `minimumRpcAgreement is ${manifest.verification.minimumRpcAgreement}.`,
          "Require agreement from at least two independent endpoints for security-sensitive reads."
        ),
    manifest.verification.minimumRpcAgreement <= manifest.rpcEndpoints.length
      ? pass()
      : finding(
          "impossible-agreement",
          "critical",
          "Verification quorum is impossible",
          `Agreement requires ${manifest.verification.minimumRpcAgreement}, but only ${manifest.rpcEndpoints.length} endpoint(s) exist.`,
          "Lower the threshold or add independently operated endpoints."
        ),
    manifest.frontend.recoveryUrl
      ? pass()
      : finding(
          "recovery-frontend",
          "high",
          "No recovery interface is declared",
          "Only the primary frontend is listed.",
          "Publish a minimal static recovery interface that can operate against the same on-chain programs."
        ),
    manifest.frontend.selfHostingGuide
      ? pass()
      : finding(
          "self-hosting-guide",
          "medium",
          "No self-hosting instructions",
          "The manifest does not tell an independent operator how to deploy the interface.",
          "Publish deterministic build and self-hosting instructions."
        ),
    manifest.license.toLowerCase() !== "proprietary"
      ? pass()
      : finding(
          "license",
          "high",
          "Source is not reusable",
          "Manifest declares a proprietary license.",
          "Use a recognized open-source license compatible with independent deployment."
        ),
    manifest.programAddresses.length > 0
      ? pass()
      : finding(
          "program-addresses",
          "medium",
          "No program addresses are declared",
          "Users cannot independently identify the on-chain programs used by the dApp.",
          "Publish program addresses for each supported network."
        ),
    irreplaceableDependencies.length === 0
      ? pass()
      : finding(
          "irreplaceable-dependencies",
          irreplaceableDependencies.some((dependency) => dependency.kind === "api") ? "critical" : "high",
          "Required dependencies have no replacement path",
          irreplaceableDependencies.map((dependency) => `${dependency.name} (${dependency.kind})`).join(", "),
          "Document a replacement, export path, fallback, or recovery mode for each required off-chain dependency."
        ),
    manifest.verification.publishEvidence
      ? pass()
      : finding(
          "evidence-publication",
          "low",
          "Verification evidence is not published",
          "publishEvidence is false.",
          "Publish machine-readable audit and failure-test evidence so claims can be independently checked."
        )
  ];

  const findings = checks.flatMap((check) => (check.finding ? [check.finding] : []));
  const penalty = findings.reduce((total, item) => total + severityPenalty[item.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    manifestName: manifest.name,
    score,
    passedChecks: checks.filter((check) => check.passed).length,
    totalChecks: checks.length,
    findings,
    generatedAt: generatedAt.toISOString()
  };
}
