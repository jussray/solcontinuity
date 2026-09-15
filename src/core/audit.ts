import type { AuditFinding, ContinuityManifest, ManifestAuditReport, RiskSeverity } from "./types.js";

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

export function auditManifest(manifest: ContinuityManifest, generatedAt = new Date()): ManifestAuditReport {
  const providers = manifest.routes.map((endpoint) => endpoint.provider ?? hostname(endpoint.url));
  const uniqueProviders = new Set(providers.map((provider) => provider.toLowerCase()));
  const requiredDependencies = manifest.dependencies.filter((dependency) => dependency.required);
  const irreplaceableDependencies = requiredDependencies.filter((dependency) => !dependency.replacement);
  const isSolana = manifest.platform.toLowerCase() === "solana";
  const programTargets = manifest.targets.filter((target) => target.kind === "program" && target.address);

  const checks: CheckResult[] = [
    manifest.routes.length >= 3
      ? pass()
      : finding(
          "route-count",
          "high",
          "Insufficient route diversity",
          `Manifest declares ${manifest.routes.length} route(s).`,
          "Declare at least three independently operated routes for meaningful failover and comparison."
        ),
    uniqueProviders.size >= 2
      ? pass()
      : finding(
          "route-provider-concentration",
          "critical",
          "Routes share one provider",
          `Detected provider set: ${[...uniqueProviders].join(", ") || "none"}.`,
          "Use routes controlled by at least two independent operators. Multiple URLs from one operator do not remove operator risk."
        ),
    manifest.verification.minimumRouteAgreement >= 2
      ? pass()
      : finding(
          "minimum-agreement",
          "high",
          "Single-source verification is allowed",
          `minimumRouteAgreement is ${manifest.verification.minimumRouteAgreement}.`,
          "Require agreement from at least two independent routes for security-sensitive reads."
        ),
    manifest.verification.minimumRouteAgreement <= manifest.routes.length
      ? pass()
      : finding(
          "impossible-agreement",
          "critical",
          "Verification quorum is impossible",
          `Agreement requires ${manifest.verification.minimumRouteAgreement}, but only ${manifest.routes.length} route(s) exist.`,
          "Lower the threshold or add independently operated routes."
        ),
    manifest.frontend.recoveryUrl
      ? pass()
      : finding(
          "recovery-frontend",
          "high",
          "No recovery interface is declared",
          "Only the primary frontend is listed.",
          "Publish a minimal recovery interface that can use the same continuity routes without the primary host."
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
    manifest.targets.length > 0
      ? pass()
      : finding(
          "targets",
          "medium",
          "No protected targets are declared",
          "The manifest does not identify the programs, contracts, services, or resources whose continuity is being protected.",
          "Declare at least one continuity target so routes and recovery evidence have an explicit subject."
        ),
    !isSolana || programTargets.length > 0
      ? pass()
      : finding(
          "solana-program-targets",
          "medium",
          "Solana adapter has no program target",
          "The Solana platform is selected but no program address is declared as a continuity target.",
          "Declare the on-chain program addresses used by the application."
        ),
    irreplaceableDependencies.length === 0
      ? pass()
      : finding(
          "irreplaceable-dependencies",
          irreplaceableDependencies.some((dependency) => dependency.kind === "api") ? "critical" : "high",
          "Required dependencies have no replacement path",
          irreplaceableDependencies.map((dependency) => `${dependency.name} (${dependency.kind})`).join(", "),
          "Document a replacement, export path, fallback, or recovery mode for each required dependency."
        ),
    manifest.verification.publishEvidence
      ? pass()
      : finding(
          "evidence-publication",
          "low",
          "Verification evidence is not published",
          "publishEvidence is false.",
          "Publish machine-readable audit and failure-test evidence so continuity claims can be independently checked."
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
