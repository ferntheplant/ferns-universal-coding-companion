import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFile } from "node:fs/promises";
import { type SidecarPaths, SIDECAR_HOST, SIDECAR_PORT, SIDECAR_URL } from "./paths";

export interface SidecarStatusPayload {
  status: "ok";
  pid: number;
  startedAt: string;
  host: string;
  port: number;
  url: string;
  dataDir: string;
  logsDir: string;
}

export interface SidecarApp {
  close(): Promise<void>;
  getStatus(): SidecarStatusPayload;
  listen(): Promise<void>;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeNotFound(res: ServerResponse): void {
  writeJson(res, 404, { error: "Not found" });
}

function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  status: SidecarStatusPayload,
): void {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "GET" && url === "/health") {
    writeJson(res, 200, {
      status: "ok",
      pid: status.pid,
      startedAt: status.startedAt,
      url: status.url,
    });
    return;
  }

  if (method === "GET" && url === "/api/status") {
    writeJson(res, 200, status);
    return;
  }

  writeNotFound(res);
}

export function createSidecarApp(paths: SidecarPaths): SidecarApp {
  const startedAt = new Date().toISOString();
  const status: SidecarStatusPayload = {
    status: "ok",
    pid: process.pid,
    startedAt,
    host: SIDECAR_HOST,
    port: SIDECAR_PORT,
    url: SIDECAR_URL,
    dataDir: paths.dataDir,
    logsDir: paths.logsDir,
  };

  const server: Server = createServer((req, res) => routeRequest(req, res, status));

  async function log(message: string): Promise<void> {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      await appendFile(paths.logFile, line, "utf8");
    } catch {
      // Logging should not crash the sidecar skeleton.
    }
  }

  return {
    async close(): Promise<void> {
      await log("sidecar shutdown requested");
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    getStatus(): SidecarStatusPayload {
      return status;
    },
    async listen(): Promise<void> {
      await log("sidecar startup requested");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(SIDECAR_PORT, SIDECAR_HOST, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      await log(`sidecar listening at ${SIDECAR_URL}`);
    },
  };
}
