import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { notifyError, notifyInfo, notifySuccess } from "./notifications";
import { getRuntimeStatus } from "./runtime";
import { ensureSidecarRunning, getSidecarStatus, openSidecarInBrowser, stopSidecar } from "./server-manager";

async function handleMainCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const { status, reused } = await ensureSidecarRunning();
  notifySuccess(
    ctx,
    reused
      ? `pi-context sidecar is already running at ${status.url}.`
      : `pi-context sidecar started at ${status.url}.`,
  );
}

async function handleOpenCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  await openSidecarInBrowser(ctx);
  notifyInfo(ctx, "pi-context dashboard open requested.");
}

async function handleStatusCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const runtime = getRuntimeStatus();
  const sidecar = await getSidecarStatus();
  const errorSuffix = runtime.sidecar.lastError ? `; lastError=${runtime.sidecar.lastError}` : "";
  notifyInfo(
    ctx,
    `startedAt=${runtime.extensionStartedAt}; sidecar=${sidecar.state}; sidecarUrl=${sidecar.url}; pid=${sidecar.pid ?? "none"}; activeSessions=${runtime.sessions.active}; pendingTurns=${runtime.sessions.pendingTurns}; dataDir=${sidecar.dataDir ?? "unavailable"}${errorSuffix}`,
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

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("pi-context", {
    description: "Show pi-context runtime status",
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
    description: "Show pi-context runtime state",
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
