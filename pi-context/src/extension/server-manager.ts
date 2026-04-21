import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notifyWarning } from "./notifications";
import { setSidecarState } from "./runtime";

interface SidecarHealthResponse {
  status: "ok";
  pid: number;
  startedAt: string;
  url: string;
}

interface SidecarStatusResponse extends SidecarHealthResponse {
  host: string;
  port: number;
  dataDir: string;
  logsDir: string;
}

export interface SidecarManagerStatus {
  running: boolean;
  state: "stopped" | "starting" | "running" | "stopping" | "error";
  url: string;
  pid: number | null;
  startedAt: string | null;
  host: string | null;
  port: number | null;
  dataDir: string | null;
  logsDir: string | null;
  lastError: string | null;
}

const SIDECAR_URL = "http://127.0.0.1:4041";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUN_COMMAND = process.platform === "win32" ? "bun.exe" : "bun";

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 5_000): Promise<SidecarHealthResponse | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fetchJson<SidecarHealthResponse>(`${SIDECAR_URL}/health`);
    if (status?.status === "ok") {
      return status;
    }
    await sleep(150);
  }
  return null;
}

export async function getSidecarStatus(): Promise<SidecarManagerStatus> {
  const liveStatus = await fetchJson<SidecarStatusResponse>(`${SIDECAR_URL}/api/status`);
  if (liveStatus?.status === "ok") {
    setSidecarState("running");
    return {
      running: true,
      state: "running",
      url: liveStatus.url,
      pid: liveStatus.pid,
      startedAt: liveStatus.startedAt,
      host: liveStatus.host,
      port: liveStatus.port,
      dataDir: liveStatus.dataDir,
      logsDir: liveStatus.logsDir,
      lastError: null,
    };
  }

  setSidecarState("stopped");
  return {
    running: false,
    state: "stopped",
    url: SIDECAR_URL,
    pid: null,
    startedAt: null,
    host: null,
    port: null,
    dataDir: null,
    logsDir: null,
    lastError: null,
  };
}

export async function ensureSidecarRunning(): Promise<{ status: SidecarManagerStatus; reused: boolean }> {
  const current = await getSidecarStatus();
  if (current.running) {
    return { status: current, reused: true };
  }

  setSidecarState("starting");

  const child = spawn(BUN_COMMAND, ["run", "sidecar"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const health = await waitForHealth();
  if (!health) {
    setSidecarState("error", "Timed out waiting for sidecar health check");
    throw new Error("Timed out waiting for pi-context sidecar to become healthy");
  }

  const status = await getSidecarStatus();
  return { status, reused: false };
}

export async function stopSidecar(): Promise<{ stopped: boolean; status: SidecarManagerStatus }> {
  const status = await getSidecarStatus();
  if (!status.running || status.pid === null) {
    setSidecarState("stopped");
    return { stopped: false, status };
  }

  setSidecarState("stopping");
  process.kill(status.pid, "SIGTERM");

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const probe = await fetchJson<SidecarHealthResponse>(`${SIDECAR_URL}/health`);
    if (!probe) {
      setSidecarState("stopped");
      return {
        stopped: true,
        status: {
          ...status,
          running: false,
          state: "stopped",
          pid: null,
          startedAt: null,
        },
      };
    }
    await sleep(150);
  }

  setSidecarState("error", "Timed out waiting for sidecar shutdown");
  throw new Error("Timed out waiting for pi-context sidecar to stop");
}

export async function openSidecarInBrowser(ctx: ExtensionCommandContext): Promise<void> {
  const { status } = await ensureSidecarRunning();
  const url = status.url;

  let command = "xdg-open";
  let args = [url];
  if (process.platform === "darwin") {
    command = "open";
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  }

  try {
    const child = spawn(command, args, {
      cwd: ctx.cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    notifyWarning(ctx, `pi-context dashboard is running at ${url}, but automatic browser open failed.`);
  }
}
