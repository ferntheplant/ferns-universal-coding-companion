import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { notifyError, notifyInfo, notifySuccess } from "./notifications";
import { getRuntimeStatus } from "./runtime";

async function handleMainCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const status = getRuntimeStatus();
  notifySuccess(
    ctx,
    `pi-context is loaded. Sidecar=${status.sidecar.state} at ${status.sidecar.url}; activeSessions=${status.sessions.active}; pendingTurns=${status.sessions.pendingTurns}.`,
  );
}

async function handleOpenCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const status = getRuntimeStatus();
  notifyInfo(
    ctx,
    `pi-context open flow will target ${status.sidecar.url}. Sidecar state is currently ${status.sidecar.state}; browser launch arrives in the sidecar milestone.`,
  );
}

async function handleStatusCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const status = getRuntimeStatus();
  const errorSuffix = status.sidecar.lastError ? `; lastError=${status.sidecar.lastError}` : "";
  notifyInfo(
    ctx,
    `startedAt=${status.extensionStartedAt}; sidecar=${status.sidecar.state}; sidecarUrl=${status.sidecar.url}; sidecarUpdatedAt=${status.sidecar.lastTransitionAt}; activeSessions=${status.sessions.active}; pendingTurns=${status.sessions.pendingTurns}${errorSuffix}`,
  );
}

async function handleStopCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const status = getRuntimeStatus();
  if (status.sidecar.state === "stopped") {
    notifyInfo(ctx, "pi-context sidecar is already stopped.");
    return;
  }

  notifyInfo(ctx, "pi-context sidecar stop is not wired yet. Current runtime state preserved.");
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
