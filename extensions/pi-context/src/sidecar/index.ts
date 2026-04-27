import { appendFile } from "node:fs/promises";
import { createSidecarApp } from "./app";
import { clearSidecarLock, writeSidecarLock } from "./lock";
import { ensureSidecarDirectories, getSidecarPaths } from "./paths";

const paths = await ensureSidecarDirectories(getSidecarPaths());
const app = createSidecarApp(paths);

let shuttingDown = false;

async function log(message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    await appendFile(paths.logFile, line, "utf8");
  } catch {
    // Best-effort logging only.
  }
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  await log(`sidecar shutdown starting with code ${exitCode}`);

  try {
    await app.close();
  } catch (error) {
    await log(`sidecar close failed: ${error instanceof Error ? error.message : String(error)}`);
    exitCode = exitCode || 1;
  }

  await clearSidecarLock();
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

process.on("uncaughtException", (error) => {
  void log(
    `uncaughtException: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  void shutdown(1);
});

process.on("unhandledRejection", (error) => {
  void log(
    `unhandledRejection: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  void shutdown(1);
});

try {
  await app.listen();
  const status = app.getStatus();
  await writeSidecarLock({
    pid: status.pid,
    port: status.port,
    url: status.url,
    startedAt: status.startedAt,
  });
  await log(`sidecar lock written for pid ${status.pid}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await log(`sidecar startup failed: ${message}`);

  if (message.includes("EADDRINUSE") || message.toLowerCase().includes("port 4041 in use")) {
    process.exit(0);
  }

  process.exit(1);
}
