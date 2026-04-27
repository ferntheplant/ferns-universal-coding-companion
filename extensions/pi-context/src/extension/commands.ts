import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "./notifications";
import { getRuntimeStatus } from "./runtime";
import {
  type SidecarManagerStatus,
  ensureSidecarRunning,
  getSidecarStatus,
  openSidecarInBrowser,
  stopSidecar,
} from "./server-manager";

const SESSION_NAME_STATUS_ID = "pi-context-name";
const SIDECAR_SESSION_NAME_URL = "http://127.0.0.1:4041/api/session/name";

interface SessionNamingApiLike {
  getSessionName?: () => unknown;
  setSessionName?: (name: string) => unknown;
  appendEntry?: (type: string, payload: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface UiStatusLike {
  setStatus?: (id: string, text: string) => void;
}

function formatRuntimeSummary(sidecar: SidecarManagerStatus): string {
  const runtime = getRuntimeStatus();
  return `sidecar=${sidecar.state}; sidecarUrl=${sidecar.url}; port=${sidecar.port ?? "unavailable"}; privacy=${sidecar.privacy ?? "standard"}; activeSessions=${runtime.sessions.active}; pendingTurns=${runtime.sessions.pendingTurns}; postedCaptures=${runtime.debug.postedCaptures}; failedPosts=${runtime.debug.failedPosts}; failedWrites=${runtime.debug.failedWrites}`;
}

async function handleMainCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const { status, reused } = await ensureSidecarRunning();
  notifySuccess(
    ctx,
    reused
      ? `pi-context sidecar reused. ${formatRuntimeSummary(status)}`
      : `pi-context sidecar started. ${formatRuntimeSummary(status)}`,
  );
}

async function handleOpenCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const { status, reused } = await openSidecarInBrowser(ctx);
  notifyInfo(
    ctx,
    reused
      ? `pi-context dashboard open requested (reused sidecar at ${status.url}).`
      : `pi-context dashboard open requested (started sidecar at ${status.url}).`,
  );
}

async function handleStatusCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const runtime = getRuntimeStatus();
  const sidecar = await getSidecarStatus();
  const errorSuffix = runtime.sidecar.lastError ? `; lastError=${runtime.sidecar.lastError}` : "";
  notifyInfo(
    ctx,
    `startedAt=${runtime.extensionStartedAt}; sidecar=${sidecar.state}; sidecarUrl=${sidecar.url}; port=${sidecar.port ?? "unavailable"}; pid=${sidecar.pid ?? "none"}; privacy=${sidecar.privacy ?? "standard"}; activeSessions=${runtime.sessions.active}; pendingTurns=${runtime.sessions.pendingTurns}; postedCaptures=${runtime.debug.postedCaptures}; failedPosts=${runtime.debug.failedPosts}; failedWrites=${runtime.debug.failedWrites}; dataDir=${sidecar.dataDir ?? "unavailable"}${errorSuffix}`,
  );
}

async function handleStopCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const result = await stopSidecar();
  if (!result.stopped) {
    notifyInfo(ctx, "pi-context sidecar is already stopped.");
    return;
  }

  notifyInfo(ctx, "pi-context sidecar stopped.");
}

function getSessionName(pi: ExtensionAPI): string | null {
  const maybeName = (pi as SessionNamingApiLike).getSessionName?.();
  if (typeof maybeName !== "string") return null;
  const trimmed = maybeName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function setSessionName(pi: ExtensionAPI, name: string): boolean {
  const setter = (pi as SessionNamingApiLike).setSessionName;
  if (!setter) return false;
  setter(name);
  return true;
}

async function appendSessionNameEntry(pi: ExtensionAPI, name: string): Promise<void> {
  const appendEntry = (pi as SessionNamingApiLike).appendEntry;
  if (!appendEntry) return;
  await appendEntry("pi-context:session-name", { name });
}

function setSessionNameStatus(ctx: ExtensionContext, name: string): void {
  (ctx.ui as UiStatusLike).setStatus?.(SESSION_NAME_STATUS_ID, name);
}

async function notifySidecarOfName(ctx: ExtensionContext, name: string): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();
  if (!sessionId || !name.trim()) return;

  try {
    await fetch(SIDECAR_SESSION_NAME_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId, name }),
    });
  } catch {
    // Best-effort: sidecar may not be running yet.
  }
}

async function handleNameCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const name = args.trim();
  if (!name) {
    const current = getSessionName(pi);
    if (current) {
      notifyInfo(ctx, `Session name: ${current}`);
    } else {
      notifyInfo(ctx, "No session name set. Usage: /name <label>");
    }
    return;
  }

  if (!setSessionName(pi, name)) {
    notifyError(ctx, "This Pi runtime does not expose session naming APIs.");
    return;
  }

  try {
    await appendSessionNameEntry(pi, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyWarning(ctx, `Session name set, but persistence entry failed: ${message}`);
  }
  setSessionNameStatus(ctx, name);
  await notifySidecarOfName(ctx, name);
  notifySuccess(ctx, `Session named: ${name}`);
}

export async function restoreNamedSessionOnStart(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const current = getSessionName(pi);
  if (!current) return;
  setSessionNameStatus(ctx, current);
  await notifySidecarOfName(ctx, current);
}

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("pi-context-name", {
    description: "Name the current session for later recall",
    async handler(args, ctx) {
      try {
        await handleNameCommand(args, ctx, pi);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `pi-context-name failed: ${message}`);
      }
    },
  });

  pi.registerCommand("pi-context", {
    description: "Start or reuse pi-context sidecar and show runtime summary",
    async handler(args, ctx) {
      try {
        await handleMainCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `pi-context failed: ${message}`);
      }
    },
  });

  pi.registerCommand("pi-context-open", {
    description: "Open the pi-context dashboard",
    async handler(args, ctx) {
      try {
        await handleOpenCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `pi-context open failed: ${message}`);
      }
    },
  });

  pi.registerCommand("pi-context-status", {
    description: "Show detailed pi-context runtime state",
    async handler(args, ctx) {
      try {
        await handleStatusCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `pi-context status failed: ${message}`);
      }
    },
  });

  pi.registerCommand("pi-context-stop", {
    description: "Stop the pi-context dashboard sidecar",
    async handler(args, ctx) {
      try {
        await handleStopCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `pi-context stop failed: ${message}`);
      }
    },
  });
}
