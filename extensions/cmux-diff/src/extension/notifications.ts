import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const PREFIX = "[cmux-diff]";

function formatMessage(message: string): string {
  return `${PREFIX} ${message}`;
}

function notify(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  message: string,
  type: "info" | "warning" | "error",
): void {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.notify(formatMessage(message), type);
}

export function notifyInfo(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string): void {
  notify(ctx, message, "info");
}

export function notifyWarning(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string): void {
  notify(ctx, message, "warning");
}

export function notifyError(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string): void {
  notify(ctx, message, "error");
}

export function notifySuccess(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string): void {
  notify(ctx, message, "info");
}
