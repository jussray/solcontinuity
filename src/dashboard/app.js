const tabs = Array.from(document.querySelectorAll("[data-tab]"));
const panels = Array.from(document.querySelectorAll("[data-panel]"));
const announcement = document.getElementById("announcement");
const editor = document.getElementById("manifest-editor");
const auditOutput = document.getElementById("audit-output");
const providerOutput = document.getElementById("provider-output");
const providerSamplesRoot = document.getElementById("provider-samples");
const apiStatus = document.getElementById("api-status");
const analyticsStatus = document.getElementById("analytics-status");
const evidenceMode = document.getElementById("evidence-mode");
const overviewEvidence = document.getElementById("overview-evidence");
const evidenceSummary = document.getElementById("evidence-summary");
const evidenceHistory = document.getElementById("evidence-history");
const liveDevnetGate = document.getElementById("live-devnet-gate");

const sampleManifest = {
  schemaVersion: "1.0",
  name: "SolContinuity Devnet Reference",
  description: "Reference application-layer resilience manifest.",
  network: "devnet",
  sourceRepository: "https://github.com/jussray/solcontinuity",
  license: "Apache-2.0",
  programAddresses: ["11111111111111111111111111111111"],
  rpcEndpoints: [
    { id: "solana-public-devnet", provider: "Solana public RPC", url: "https://api.devnet.solana.com" },
    { id: "onfinality-public-devnet", provider: "OnFinality", url: "https://solana-devnet.api.onfinality.io/public" },
    { id: "triton-public-devnet", provider: "Triton One", url: "https://api.devnet.rpcpool.com" }
  ],
  frontend: {
    primaryUrl: "https://app.example.org",
    recoveryUrl: "https://recovery.example.org",
    selfHostingGuide: "https://docs.example.org/self-host"
  },
  dependencies: [
    { name: "Evidence storage", kind: "storage", required: true, replacement: "Portable evidence bundle" }
  ],
  verification: { minimumRpcAgreement: 2, commitment: "confirmed", publishEvidence: true }
};

const sampleProviders = [
  { endpoint_id: "solana-public-devnet", operator: "Solana public RPC", healthy: true, latency_ms: 175, agrees_with_majority: true },
  { endpoint_id: "onfinality-public-devnet", operator: "OnFinality", healthy: true, latency_ms: 240, agrees_with_majority: true },
  { endpoint_id: "triton-public-devnet", operator: "Triton One", healthy: false, latency_ms: 1600, agrees_with_majority: false }
];

function activateTab(name) {
  tabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === name)));
  panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== name));
  announcement.textContent = `Showing ${name}.`;
}

function providerName(endpoint) {
  if (endpoint.provider) return String(endpoint.provider).trim().toLowerCase();
  try {
    return new URL(endpoint.url).hostname.toLowerCase();
  } catch {
    return "invalid-provider";
  }
}

function localAudit(manifest) {
  const findings = [];
  const endpoints = Array.isArray(manifest.rpcEndpoints) ? manifest.rpcEndpoints : [];
  const providers = new Set(endpoints.map(providerName));
  if (endpoints.length < 3) findings.push("HIGH: fewer than three RPC endpoints");
  if (providers.size < 2) findings.push("CRITICAL: RPC provider concentration");
  if (!manifest.frontend?.recoveryUrl) findings.push("HIGH: no recovery frontend");
  if (!manifest.frontend?.selfHostingGuide) findings.push("MEDIUM: no self-hosting guide");
  if ((manifest.verification?.minimumRpcAgreement || 0) < 2) findings.push("HIGH: single-source verification allowed");
  const irreplaceable = (manifest.dependencies || []).filter((item) => item.required && !item.replacement);
  if (irreplaceable.length) findings.push(`CRITICAL: ${irreplaceable.length} required dependency path(s) lack replacements`);
  const score = Math.max(0, 100 - findings.reduce((total, item) => total + (item.startsWith("CRITICAL") ? 30 : item.startsWith("HIGH") ? 20 : 10), 0));
  return { score, findingCount: findings.length, findings: findings.length ? findings : ["PASS: no modeled resilience findings"], source: "offline-browser-model" };
}

function localProviderScore(observations) {
  if (!observations.length) return { score: 0, flags: ["NO_PROVIDER_EVIDENCE"], source: "offline-browser-model" };
  const healthy = observations.filter((item) => item.healthy);
  const operators = new Set(healthy.map((item) => item.operator.trim().toLowerCase()));
  const availability = healthy.length / observations.length;
  const diversity = Math.min(1, operators.size / 2);
  const sortedLatencies = healthy.map((item) => item.latency_ms).sort((a, b) => a - b);
  const p95 = sortedLatencies[Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1)] || 10000;
  const latency = Math.max(0, Math.min(1, 1 - p95 / 1500));
  const agreement = healthy.length ? healthy.filter((item) => item.agrees_with_majority).length / healthy.length : 0;
  const score = Math.round((availability * 0.4 + diversity * 0.3 + latency * 0.15 + agreement * 0.15) * 100);
  const flags = [];
  if (availability < 0.67) flags.push("LOW_AVAILABILITY");
  if (operators.size < 2) flags.push("OPERATOR_CONCENTRATION");
  if (latency < 0.35) flags.push("HIGH_P95_LATENCY");
  if (agreement < 0.67) flags.push("RESPONSE_DISAGREEMENT");
  return { score, dimensions: { availability, operatorDiversity: diversity, latency, agreement }, flags, source: "offline-browser-model" };
}

function canUseApi() {
  return location.protocol === "http:" || location.protocol === "https:";
}

async function apiRequest(path, options) {
  if (!canUseApi()) throw new Error("API unavailable in static artifact mode.");
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function formatTime(value) {
  if (!value) return "Unknown time";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function renderEvidenceRecord(record) {
  const card = document.createElement("article");
  card.className = "evidence-card";

  const header = document.createElement("div");
  header.className = "evidence-card-header";
  const titleGroup = document.createElement("div");
  titleGroup.append(
    textElement("span", `status-pill status-${record.status === "passed" ? "passed" : "neutral"}`, record.status || "unknown"),
    textElement("h3", "", record.transaction?.kind === "memo" ? "Signed Memo transaction" : "Blockchain evidence")
  );
  header.append(titleGroup, textElement("time", "evidence-time", formatTime(record.generatedAt)));
  card.append(header);

  const assessment = record.assessment;
  const metrics = document.createElement("dl");
  metrics.className = "evidence-grid";
  const rows = [
    ["Network", record.network || "unknown"],
    ["Assessment", assessment ? `${assessment.verdict} · ${assessment.score}/100` : record.assessmentError || "not scored"],
    ["Confirmed by", (record.transaction?.verification?.confirmedBy || []).join(", ") || "none"],
    ["Routes attempted", String(record.transaction?.broadcast?.observations?.length || 0)],
    ["Commitment", record.transaction?.verification?.commitment || "unknown"],
    ["Balance", Number.isFinite(record.funding?.balanceLamports) ? `${record.funding.balanceLamports} lamports` : "unknown"]
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.append(textElement("dt", "", label), textElement("dd", "", value));
    metrics.append(row);
  });
  card.append(metrics);

  const signatureLabel = textElement("p", "evidence-label", "Transaction signature");
  const signature = textElement("code", "evidence-signature", record.transaction?.signature || "No signature recorded");
  card.append(signatureLabel, signature);

  if (record.transaction?.memo) {
    const details = document.createElement("details");
    details.append(textElement("summary", "", "Evidence memo"), textElement("pre", "", record.transaction.memo));
    card.append(details);
  }

  return card;
}

function renderStaticEvidenceMode() {
  evidenceHistory.replaceChildren();
  evidenceSummary.textContent = "Live evidence history requires the SolContinuity API. Static recovery mode makes no live-chain claim.";
  evidenceHistory.append(textElement("div", "evidence-empty", "The recovery console remains usable for audits and provider modeling without claiming current blockchain state."));
}

async function loadEvidenceHistory() {
  if (!canUseApi()) {
    renderStaticEvidenceMode();
    return;
  }

  evidenceSummary.textContent = "Loading sanitized transaction evidence.";
  evidenceHistory.replaceChildren();
  try {
    const payload = await apiRequest("/api/evidence/history?limit=20");
    const records = Array.isArray(payload.records) ? payload.records : [];
    if (!records.length) {
      evidenceSummary.textContent = "No readable evidence artifacts are configured. No live-chain claim is being made.";
      evidenceHistory.append(textElement("div", "evidence-empty", "Configure SOLCONTINUITY_EVIDENCE_PATHS or run the live Devnet evidence workflow."));
      return;
    }
    evidenceSummary.textContent = `${records.length} sanitized evidence record${records.length === 1 ? "" : "s"}. Serialized transaction bytes are never returned.`;
    records.forEach((record) => evidenceHistory.append(renderEvidenceRecord(record)));
    if (Array.isArray(payload.errors) && payload.errors.length) {
      evidenceHistory.append(textElement("p", "evidence-error", `${payload.errors.length} evidence source error(s) were preserved.`));
    }
    announcement.textContent = "Live evidence history refreshed.";
  } catch (error) {
    evidenceSummary.textContent = `Evidence history unavailable: ${error instanceof Error ? error.message : String(error)}. No live-chain claim is being made.`;
    evidenceHistory.append(textElement("div", "evidence-empty", "The Console failed closed and preserved the truth boundary."));
    announcement.textContent = "Evidence history unavailable; no live claim was made.";
  }
}

async function refreshOverview() {
  if (!canUseApi()) {
    apiStatus.textContent = "Offline";
    analyticsStatus.textContent = "Offline";
    evidenceMode.textContent = "Evidence mode: static artifact";
    evidenceMode.classList.add("neutral");
    overviewEvidence.textContent = "Evidence: Static artifact mode. The console is interactive, but no backend or live-chain claim is being made.";
    liveDevnetGate.checked = false;
    return;
  }

  try {
    const payload = await apiRequest("/api/overview");
    apiStatus.textContent = "Connected";
    analyticsStatus.textContent = payload.analyticsConfigured ? "Configured" : "Not configured";
    evidenceMode.textContent = payload.proofGates?.liveDevnet ? "Evidence mode: live proof loaded" : "Evidence mode: backend connected";
    evidenceMode.classList.toggle("neutral", !payload.proofGates?.liveDevnet);
    overviewEvidence.textContent = `Evidence: ${payload.manifest} audit score ${payload.audit.score}/100. Boundary: ${payload.boundary}. Live Devnet proof: ${payload.proofGates?.liveDevnet ? "verified artifact loaded" : "not currently loaded"}.`;
    liveDevnetGate.checked = Boolean(payload.proofGates?.liveDevnet);
    announcement.textContent = "Backend evidence refreshed.";
  } catch (error) {
    apiStatus.textContent = "Unavailable";
    analyticsStatus.textContent = "Unknown";
    evidenceMode.textContent = "Evidence mode: fallback";
    evidenceMode.classList.add("neutral");
    overviewEvidence.textContent = `Evidence unavailable: ${error instanceof Error ? error.message : String(error)}`;
    liveDevnetGate.checked = false;
    announcement.textContent = "Backend evidence unavailable; no live claim was made.";
  }
}

async function runAudit() {
  try {
    const manifest = JSON.parse(editor.value);
    let report;
    if (canUseApi()) {
      try {
        report = await apiRequest("/api/audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(manifest)
        });
        report.source = "solcontinuity-node-api";
      } catch {
        report = localAudit(manifest);
      }
    } else {
      report = localAudit(manifest);
    }
    auditOutput.textContent = JSON.stringify(report, null, 2);
    announcement.textContent = `Audit complete. Score ${report.score}. Source ${report.source || "typed-core"}.`;
  } catch (error) {
    auditOutput.textContent = `INVALID JSON: ${error instanceof Error ? error.message : String(error)}`;
    announcement.textContent = "Audit blocked by invalid JSON.";
  }
}

function renderProviderSamples() {
  providerSamplesRoot.replaceChildren();
  sampleProviders.forEach((item) => {
    const card = document.createElement("article");
    card.className = "provider-card";
    const heading = document.createElement("div");
    heading.append(textElement("strong", "", item.endpoint_id), textElement("span", "", item.operator));
    const list = document.createElement("dl");
    [["Health", item.healthy ? "Healthy" : "Failed"], ["Latency", `${item.latency_ms} ms`], ["Agreement", item.agrees_with_majority ? "Yes" : "No"]].forEach(([label, value]) => {
      const row = document.createElement("div");
      row.append(textElement("dt", "", label), textElement("dd", "", value));
      list.append(row);
    });
    card.append(heading, list);
    providerSamplesRoot.append(card);
  });
}

async function runProviderScore() {
  let report;
  if (canUseApi()) {
    try {
      report = await apiRequest("/api/provider-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ observations: sampleProviders })
      });
      report.source = "solcontinuity-python-analytics";
    } catch {
      report = localProviderScore(sampleProviders);
    }
  } else {
    report = localProviderScore(sampleProviders);
  }
  providerOutput.textContent = JSON.stringify(report, null, 2);
  announcement.textContent = `Provider evidence scored ${report.score}. Source ${report.source}.`;
}

function resetManifest() {
  editor.value = JSON.stringify(sampleManifest, null, 2);
  auditOutput.textContent = "Ready to audit.";
}

tabs.forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
document.getElementById("reset-manifest").addEventListener("click", resetManifest);
document.getElementById("run-audit").addEventListener("click", runAudit);
document.getElementById("run-provider-score").addEventListener("click", runProviderScore);
document.getElementById("refresh-evidence").addEventListener("click", async () => {
  await Promise.all([refreshOverview(), loadEvidenceHistory()]);
});
document.getElementById("refresh-history").addEventListener("click", loadEvidenceHistory);

renderProviderSamples();
resetManifest();
activateTab("overview");
refreshOverview();
loadEvidenceHistory();
