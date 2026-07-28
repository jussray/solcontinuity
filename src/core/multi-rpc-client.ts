import { canonicalize } from "./canonicalize.js";
import { QuorumError, ResilienceError } from "./errors.js";
import type {
  Commitment,
  EndpointHealth,
  EndpointObservation,
  JsonRpcResponse,
  RequestStrategy,
  RpcEndpointConfig,
  RpcRequestResult,
  TransactionVerification
} from "./types.js";

export interface MultiRpcClientOptions {
  readonly endpoints: readonly RpcEndpointConfig[];
  readonly defaultTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface SignatureStatusValue {
  readonly confirmationStatus?: Commitment | null;
  readonly confirmations?: number | null;
  readonly err?: unknown;
  readonly slot: number;
}

interface SignatureStatusesResult {
  readonly context: { readonly slot: number };
  readonly value: readonly (SignatureStatusValue | null)[];
}

function providerName(endpoint: RpcEndpointConfig): string {
  if (endpoint.provider?.trim()) {
    return endpoint.provider.trim();
  }

  try {
    return new URL(endpoint.url).hostname;
  } catch {
    return endpoint.id;
  }
}

function ensureUniqueEndpoints(endpoints: readonly RpcEndpointConfig[]): void {
  if (endpoints.length === 0) {
    throw new ResilienceError("At least one RPC endpoint is required.", "NO_ENDPOINTS");
  }

  const ids = new Set<string>();
  for (const endpoint of endpoints) {
    if (ids.has(endpoint.id)) {
      throw new ResilienceError(`Duplicate RPC endpoint id: ${endpoint.id}`, "DUPLICATE_ENDPOINT_ID");
    }
    ids.add(endpoint.id);
  }
}

export class MultiRpcClient {
  readonly #endpoints: readonly RpcEndpointConfig[];
  readonly #defaultTimeoutMs: number;
  readonly #fetch: typeof fetch;

  public constructor(options: MultiRpcClientOptions) {
    ensureUniqueEndpoints(options.endpoints);
    this.#endpoints = [...options.endpoints];
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 4_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  public get endpoints(): readonly RpcEndpointConfig[] {
    return this.#endpoints;
  }

  public async request<T>(
    method: string,
    params: readonly unknown[] = [],
    strategy: RequestStrategy = { mode: "quorum" }
  ): Promise<RpcRequestResult<T>> {
    if (strategy.mode === "first-success") {
      return this.#requestFirstSuccess<T>(method, params);
    }

    return this.#requestQuorum<T>(
      method,
      params,
      strategy.minimumAgreement,
      strategy.minimumProviderAgreement
    );
  }

  public async healthCheck(): Promise<readonly EndpointHealth[]> {
    return Promise.all(
      this.#endpoints.map(async (endpoint): Promise<EndpointHealth> => {
        const startedAt = performance.now();
        try {
          const health = await this.#requestEndpoint<string>(endpoint, "getHealth", []);
          const slot = await this.#requestEndpoint<number>(endpoint, "getSlot", [{ commitment: "confirmed" }]);
          return {
            endpointId: endpoint.id,
            provider: providerName(endpoint),
            healthy: health === "ok",
            slot,
            elapsedMs: Math.round(performance.now() - startedAt)
          };
        } catch (error) {
          return {
            endpointId: endpoint.id,
            provider: providerName(endpoint),
            healthy: false,
            elapsedMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );
  }

  public async broadcastTransaction(
    transactionBase64: string,
    options: {
      readonly skipPreflight?: boolean;
      readonly maxRetries?: number;
      readonly minimumAcceptances?: number;
      readonly minimumProviderAcceptances?: number;
    } = {}
  ): Promise<RpcRequestResult<string>> {
    const minimumAcceptances = options.minimumAcceptances ?? 1;
    const minimumProviderAcceptances = options.minimumProviderAcceptances ?? 1;
    const observations = await Promise.all(
      this.#endpoints.map((endpoint) =>
        this.#observe<string>(endpoint, "sendTransaction", [
          transactionBase64,
          {
            encoding: "base64",
            skipPreflight: options.skipPreflight ?? false,
            maxRetries: options.maxRetries ?? 3
          }
        ])
      )
    );

    const successful = observations.filter(
      (observation): observation is EndpointObservation<string> & { readonly value: string } =>
        observation.ok && typeof observation.value === "string"
    );

    const grouped = new Map<string, typeof successful>();
    for (const observation of successful) {
      const group = grouped.get(observation.value) ?? [];
      group.push(observation);
      grouped.set(observation.value, group);
    }

    const winner = [...grouped.entries()].sort((left, right) => right[1].length - left[1].length)[0];
    const winningProviderCount = winner
      ? new Set(winner[1].map((item) => item.provider.toLowerCase())).size
      : 0;
    if (
      !winner ||
      winner[1].length < minimumAcceptances ||
      winningProviderCount < minimumProviderAcceptances
    ) {
      throw new QuorumError("Transaction broadcast did not reach the required acceptance count.", {
        minimumAcceptances,
        minimumProviderAcceptances,
        observations
      });
    }

    return {
      value: winner[0],
      evidence: {
        method: "sendTransaction",
        strategy: "quorum",
        selectedEndpointIds: winner[1].map((item) => item.endpointId),
        agreementCount: winner[1].length,
        providerAgreementCount: winningProviderCount,
        observations
      }
    };
  }

  public async verifySignature(
    signature: string,
    commitment: Commitment = "confirmed"
  ): Promise<TransactionVerification> {
    const observations = await Promise.all(
      this.#endpoints.map(async (endpoint) => {
        try {
          const result = await this.#requestEndpoint<SignatureStatusesResult>(endpoint, "getSignatureStatuses", [
            [signature],
            { searchTransactionHistory: true }
          ]);
          return { endpoint, status: result.value[0] ?? null, error: null };
        } catch (error) {
          return {
            endpoint,
            status: null,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );

    const confirmedBy: string[] = [];
    const rejectedBy: string[] = [];
    const pendingAt: string[] = [];
    const desiredRank = this.#commitmentRank(commitment);

    for (const observation of observations) {
      const id = observation.endpoint.id;
      if (observation.error || observation.status === null) {
        pendingAt.push(id);
        continue;
      }
      if (observation.status.err !== null && observation.status.err !== undefined) {
        rejectedBy.push(id);
        continue;
      }
      const actualRank = this.#commitmentRank(observation.status.confirmationStatus ?? "processed");
      if (actualRank >= desiredRank) {
        confirmedBy.push(id);
      } else {
        pendingAt.push(id);
      }
    }

    return { signature, confirmedBy, rejectedBy, pendingAt, commitment };
  }

  async #requestFirstSuccess<T>(method: string, params: readonly unknown[]): Promise<RpcRequestResult<T>> {
    const observations: EndpointObservation<T>[] = [];
    for (const endpoint of this.#endpoints) {
      const observation = await this.#observe<T>(endpoint, method, params);
      observations.push(observation);
      if (observation.ok && observation.value !== undefined) {
        return {
          value: observation.value,
          evidence: {
            method,
            strategy: "first-success",
            selectedEndpointIds: [endpoint.id],
            agreementCount: 1,
            providerAgreementCount: 1,
            observations
          }
        };
      }
    }

    throw new ResilienceError(`All RPC endpoints failed for ${method}.`, "ALL_ENDPOINTS_FAILED", observations);
  }

  async #requestQuorum<T>(
    method: string,
    params: readonly unknown[],
    minimumAgreement?: number,
    minimumProviderAgreement?: number
  ): Promise<RpcRequestResult<T>> {
    const observations = await Promise.all(
      this.#endpoints.map((endpoint) => this.#observe<T>(endpoint, method, params))
    );
    const required = minimumAgreement ?? Math.floor(this.#endpoints.length / 2) + 1;
    const requiredProviders = minimumProviderAgreement ?? 1;
    const groups = new Map<string, EndpointObservation<T>[]>();

    for (const observation of observations) {
      if (!observation.ok || observation.canonicalValue === undefined) {
        continue;
      }
      const group = groups.get(observation.canonicalValue) ?? [];
      group.push(observation);
      groups.set(observation.canonicalValue, group);
    }

    const winner = [...groups.values()].sort((left, right) => right.length - left.length)[0];
    const selected = winner?.[0];
    const winnerProviderCount = winner
      ? new Set(winner.map((item) => item.provider.toLowerCase())).size
      : 0;
    if (
      !winner ||
      !selected ||
      selected.value === undefined ||
      winner.length < required ||
      winnerProviderCount < requiredProviders
    ) {
      throw new QuorumError(`RPC quorum not reached for ${method}; required ${required}.`, {
        required,
        requiredProviders,
        observations
      });
    }

    return {
      value: selected.value,
      evidence: {
        method,
        strategy: "quorum",
        selectedEndpointIds: winner.map((item) => item.endpointId),
        agreementCount: winner.length,
        providerAgreementCount: winnerProviderCount,
        observations
      }
    };
  }

  async #observe<T>(
    endpoint: RpcEndpointConfig,
    method: string,
    params: readonly unknown[]
  ): Promise<EndpointObservation<T>> {
    const startedAt = performance.now();
    try {
      const value = await this.#requestEndpoint<T>(endpoint, method, params);
      return {
        endpointId: endpoint.id,
        provider: providerName(endpoint),
        ok: true,
        elapsedMs: Math.round(performance.now() - startedAt),
        value,
        canonicalValue: canonicalize(value)
      };
    } catch (error) {
      return {
        endpointId: endpoint.id,
        provider: providerName(endpoint),
        ok: false,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async #requestEndpoint<T>(
    endpoint: RpcEndpointConfig,
    method: string,
    params: readonly unknown[]
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = endpoint.timeoutMs ?? this.#defaultTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestId = `${endpoint.id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

    try {
      const response = await this.#fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(endpoint.headers ?? {})
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new ResilienceError(
          `${endpoint.id} returned HTTP ${response.status}.`,
          "RPC_HTTP_ERROR"
        );
      }

      const payload = (await response.json()) as JsonRpcResponse<T>;
      if ("error" in payload) {
        throw new ResilienceError(
          `${endpoint.id} RPC error ${payload.error.code}: ${payload.error.message}`,
          "RPC_RESPONSE_ERROR",
          payload.error.data
        );
      }

      return payload.result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ResilienceError(`${endpoint.id} timed out after ${timeoutMs}ms.`, "RPC_TIMEOUT", error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  #commitmentRank(commitment: Commitment): number {
    switch (commitment) {
      case "processed":
        return 1;
      case "confirmed":
        return 2;
      case "finalized":
        return 3;
    }
  }
}
