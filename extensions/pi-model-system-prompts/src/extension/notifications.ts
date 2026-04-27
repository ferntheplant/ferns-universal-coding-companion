import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export function notifyInfo(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "info");
}

export function notifyWarning(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "warning");
}

export function notifyError(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "error");
}

export function notifySuccess(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "info");
}
