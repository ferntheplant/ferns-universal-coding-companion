import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ProviderAdapter, ProviderUsageResult } from "../providers/types";

export const FOOTER_STATUS_KEY = "pi-usage";

export function clearUsageFooter(ctx: ExtensionContext): void {
  ctx.ui.setStatus(FOOTER_STATUS_KEY, undefined);
}

export function setUsageFooter(ctx: ExtensionContext, text: string | null): void {
  ctx.ui.setStatus(FOOTER_STATUS_KEY, text ?? undefined);
}

export function updateFooterFromUsage(
  ctx: ExtensionContext,
  provider: ProviderAdapter,
  result: ProviderUsageResult,
): void {
  const footer = provider.renderFooter(result);
  setUsageFooter(ctx, footer);
}
