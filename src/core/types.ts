export type Commitment = "processed" | "confirmed" | "finalized";

export interface RpcEndpointConfig {
  readonly id: string;
  readonly url: string;
  readonly provider?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export type RequestStrategy =
  | { readonly mode: "first-success" }
  | {
      readonly mode: "quorum";
      readonly minimumAgreement?: number;
      readonly minimumProviderAgreement?: number;
    };

export interface JsonRpcSuccess<T> {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result: T;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export interface EndpointObservation<T> {
  readonly endpointId: string;
  readonly provider: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly value?: T;
  readonly canonicalValue?: string;
  readonly error?: string;
}

export interface RpcRequestEvidence<T> {
  readonly method: string;
  readonly strategy: RequestStrategy["mode"];
  readonly selectedEndpointIds: readonly string[];
  readonly agreementCount: number;
  readonly providerAgreementCount: number;
  readonly observations: readonly EndpointObservation<T>[];
}

export interface RpcRequestResult<T> {
  readonly value: T;
  readonly evidence: RpcRequestEvidence<T>;
}

export interface EndpointHealth {
  readonly endpointId: string;
  readonly provider: string;
  readonly healthy: boolean;
  readonly slot?: number;
  readonly elapsedMs: number;
  readonly error?: string;
}

export interface TransactionVerification {
  readonly signature: string;
  readonly confirmedBy: readonly string[];
  readonly rejectedBy: readonly string[];
  readonly pendingAt: readonly string[];
  readonly commitment: Commitment;
}

export interface DappManifest {
  readonly schemaVersion: "1.0";
  readonly name: string;
  readonly description: string;
  readonly network: "devnet" | "testnet" | "mainnet-beta" | "localnet";
  readonly sourceRepository: string;
  readonly license: string;
  readonly programAddresses: readonly string[];
  readonly rpcEndpoints: readonly RpcEndpointConfig[];
  readonly frontend: {
    readonly primaryUrl: string;
    readonly recoveryUrl?: string;
    readonly selfHostingGuide?: string;
  };
  readonly dependencies: readonly {
    readonly name: string;
    readonly kind: "rpc" | "indexer" | "api" | "storage" | "identity" | "other";
    readonly required: boolean;
    readonly replacement?: string;
  }[];
  readonly verification: {
    readonly minimumRpcAgreement: number;
    readonly commitment: Commitment;
    readonly publishEvidence: boolean;
  };
}

export type RiskSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface AuditFinding {
  readonly id: string;
  readonly severity: RiskSeverity;
  readonly title: string;
  readonly evidence: string;
  readonly recommendation: string;
}

export interface ManifestAuditReport {
  readonly manifestName: string;
  readonly score: number;
  readonly passedChecks: number;
  readonly totalChecks: number;
  readonly findings: readonly AuditFinding[];
  readonly generatedAt: string;
}
