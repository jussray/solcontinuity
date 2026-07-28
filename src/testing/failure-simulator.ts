import type { RpcEndpointConfig } from "../core/types.js";

export interface MockRpcBehavior {
  readonly health?: "ok" | "behind";
  readonly slot?: number;
  readonly delayMs?: number;
  readonly failHttp?: number;
  readonly methodResults?: Readonly<Record<string, unknown>>;
}

export interface MockRpcServer {
  readonly endpoint: RpcEndpointConfig;
  readonly close: () => Promise<void>;
}

export async function createMockRpcServer(
  id: string,
  behavior: MockRpcBehavior
): Promise<MockRpcServer> {
  const { createServer } = await import("node:http");

  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (behavior.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
    }

    if (behavior.failHttp) {
      response.writeHead(behavior.failHttp, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "simulated failure" }));
      return;
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id: string | number;
      method: string;
    };
    const methodResult = behavior.methodResults?.[payload.method];
    const result =
      methodResult !== undefined
        ? methodResult
        : payload.method === "getHealth"
          ? behavior.health ?? "ok"
          : payload.method === "getSlot"
            ? behavior.slot ?? 123
            : null;

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock RPC server did not expose a TCP address.");
  }

  return {
    endpoint: {
      id,
      provider: `mock-${id}`,
      url: `http://127.0.0.1:${address.port}`,
      timeoutMs: 500
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
