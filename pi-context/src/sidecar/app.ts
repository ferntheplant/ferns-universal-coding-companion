import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { type SidecarPaths, SIDECAR_HOST, SIDECAR_PORT, SIDECAR_URL } from "./paths";
import { initTokenizer } from "./context-lens/core";
import { Store } from "./context-lens/server/store";
import { createApp as createContextLensApp, loadHtmlUI } from "./context-lens/server/webui";

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

  // Provenance: this sidecar embeds Context Lens modules lifted from
  // `references/context-lens` and adapted for Pi-native ingestion.
  const store = new Store({
    dataDir: paths.dataDir,
    stateFile: join(paths.dataDir, "state.jsonl"),
    maxSessions: 200,
    maxCompactMessages: 60,
    privacy: "standard",
  });
  store.loadState();

  const baseDir = join(dirname(fileURLToPath(import.meta.url)), "context-lens", "server");
  const contextLensApp = createContextLensApp(store, loadHtmlUI(), baseDir);
  const app = new Hono();
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      pid: status.pid,
      startedAt: status.startedAt,
      url: status.url,
    }),
  );
  app.get("/api/status", (c) => c.json(status));
  app.route("/", contextLensApp);
  let server: ReturnType<typeof serve> | null = null;

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
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
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
      try {
        await initTokenizer();
      } catch {
        // Tokenizer preload is best-effort; Context Lens falls back safely.
      }
      await new Promise<void>((resolve, reject) => {
        server = serve(
          {
            fetch: app.fetch,
            hostname: SIDECAR_HOST,
            port: SIDECAR_PORT,
          },
          () => resolve(),
        );
        server.once("error", reject);
      });
      await log(`sidecar listening at ${SIDECAR_URL}`);
    },
  };
}
