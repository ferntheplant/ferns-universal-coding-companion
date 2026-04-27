import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { clearReviewContexts, getActiveReviewTokens } from "./review-registry";
import { handleReviewServerRequest } from "./routes";
import { clearViewerAssetCache } from "./viewer-assets";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;

let bunServerInstance: Bun.Server<unknown> | undefined;
let nodeServerInstance: ReturnType<typeof createServer> | undefined;
let nodeServerPort: number | undefined;
let serverStartedAt: number | undefined;

export interface ReviewServerStatus {
  running: boolean;
  host?: string;
  port?: number;
  url?: string;
  startedAt?: number;
  uptimeMs?: number;
  activeTokens: string[];
}

export interface StartServerResult {
  host: string;
  port: number;
  url: string;
  reused: boolean;
}

function isServerRunning(): boolean {
  return Boolean(bunServerInstance || nodeServerInstance);
}

function getServerHost(): string {
  return bunServerInstance?.hostname ?? DEFAULT_HOST;
}

function getServerPort(): number | undefined {
  if (bunServerInstance) {
    return bunServerInstance.port;
  }

  return nodeServerPort;
}

function getBaseUrl(): string | undefined {
  const port = getServerPort();
  if (port === undefined) {
    return undefined;
  }

  return `http://${getServerHost()}:${port}`;
}

function getServerPortOrThrow(): number {
  const port = getServerPort();
  if (port === undefined) {
    throw new Error("Review server port is unavailable");
  }
  return port;
}

function withNodeRequestBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

async function handleNodeHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const method = req.method ?? "GET";
    const host = req.headers.host ?? `${DEFAULT_HOST}:${getServerPortOrThrow()}`;
    const path = req.url ?? "/";
    const url = `http://${host}${path}`;

    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : Buffer.from(await withNodeRequestBody(req));

    const request = new Request(url, {
      method,
      headers: req.headers as HeadersInit,
      body,
    });

    const response = await handleReviewServerRequest(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const bytes = new Uint8Array(await response.arrayBuffer());
    res.end(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`cmux-diff server error: ${message}`);
  }
}

async function startNodeServer(): Promise<void> {
  if (nodeServerInstance) {
    return;
  }

  nodeServerInstance = createServer((req, res) => {
    void handleNodeHttpRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const server = nodeServerInstance;
    if (!server) {
      reject(new Error("Failed to allocate Node.js server instance"));
      return;
    }

    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(DEFAULT_PORT, DEFAULT_HOST);
  });

  const address = nodeServerInstance.address();
  if (address && typeof address === "object") {
    nodeServerPort = address.port;
  } else {
    throw new Error("Node.js server did not provide a TCP port");
  }
}

export async function startServer(): Promise<StartServerResult> {
  if (isServerRunning()) {
    return {
      host: getServerHost(),
      port: getServerPortOrThrow(),
      url: getBaseUrl()!,
      reused: true,
    };
  }

  if (typeof Bun !== "undefined" && typeof Bun.serve === "function") {
    bunServerInstance = Bun.serve({
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      fetch: handleReviewServerRequest,
    });
  } else {
    await startNodeServer();
  }

  serverStartedAt = Date.now();

  return {
    host: getServerHost(),
    port: getServerPortOrThrow(),
    url: getBaseUrl()!,
    reused: false,
  };
}

export function stopServer(): { stopped: boolean; contextsCleared: boolean } {
  const hadServer = isServerRunning();

  if (bunServerInstance) {
    bunServerInstance.stop(true);
    bunServerInstance = undefined;
  }

  if (nodeServerInstance) {
    nodeServerInstance.close();
    nodeServerInstance = undefined;
    nodeServerPort = undefined;
  }

  serverStartedAt = undefined;
  clearReviewContexts();
  clearViewerAssetCache();

  return {
    stopped: hadServer,
    contextsCleared: true,
  };
}

export function getServerStatus(now = Date.now()): ReviewServerStatus {
  const running = isServerRunning();
  const port = getServerPort();
  const startedAt = serverStartedAt;

  return {
    running,
    host: running ? getServerHost() : undefined,
    port,
    url: running ? getBaseUrl() : undefined,
    startedAt,
    uptimeMs: running && startedAt !== undefined ? Math.max(0, now - startedAt) : undefined,
    activeTokens: getActiveReviewTokens(),
  };
}
