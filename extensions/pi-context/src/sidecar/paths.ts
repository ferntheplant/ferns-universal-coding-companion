import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SIDECAR_HOST = "127.0.0.1";
export const SIDECAR_PORT = 4041;
export const SIDECAR_URL = `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;

export interface SidecarPaths {
  rootDir: string;
  dataDir: string;
  logsDir: string;
  runDir: string;
  lockFile: string;
  logFile: string;
}

export function getSidecarPaths(): SidecarPaths {
  const rootDir = join(homedir(), ".pi-context");
  const dataDir = join(rootDir, "data");
  const logsDir = join(rootDir, "logs");
  const runDir = join(rootDir, "run");

  return {
    rootDir,
    dataDir,
    logsDir,
    runDir,
    lockFile: join(runDir, "sidecar.lock.json"),
    logFile: join(logsDir, "sidecar.log"),
  };
}

export async function ensureSidecarDirectories(paths = getSidecarPaths()): Promise<SidecarPaths> {
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runDir, { recursive: true });
  return paths;
}
