import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

function prefix(message: string): string {
  return `[usage] ${message}`;
}

export function notifyInfo(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(prefix(message), "info");
}

export function notifySuccess(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(prefix(message), "info");
}

export function notifyError(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(prefix(message), "error");
}
