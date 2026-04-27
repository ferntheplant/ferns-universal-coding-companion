import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { FOOTER_STATUS_KEY } from "./footer";

function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count < 1_000) return count.toString();
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function alignLeftRight(width: number, left: string, right: string): string {
  const minPadding = 2;
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);

  if (leftWidth + minPadding + rightWidth <= width) {
    const padding = " ".repeat(Math.max(minPadding, width - leftWidth - rightWidth));
    return left + padding + right;
  }

  if (rightWidth >= width) {
    return truncateToWidth(right, width, "");
  }

  const availableLeft = Math.max(0, width - minPadding - rightWidth);
  const truncatedLeft = truncateToWidth(left, availableLeft, "...");
  const pad = " ".repeat(Math.max(minPadding, width - visibleWidth(truncatedLeft) - rightWidth));
  return truncatedLeft + pad + right;
}

function renderTinyBar(percent: number | null, width = 10): string {
  if (percent === null || !Number.isFinite(percent)) {
    return "░".repeat(width);
  }

  const bounded = Math.max(0, Math.min(100, percent));
  const filled = Math.round((bounded / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function normalizeCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

function getThinkingSummary(ctx: ExtensionContext, pi: ExtensionAPI): string {
  const level = pi.getThinkingLevel();
  const modelId = ctx.model?.id ?? "no-model";
  const provider = ctx.model?.provider ?? "no-provider";
  return `(${provider}) ${modelId} • ${level}`;
}

function sumAssistantUsage(ctx: ExtensionContext): {
  input: number;
  output: number;
  cacheRead: number;
  costTotal: number;
} {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let costTotal = 0;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const message = entry.message as AssistantMessage;
    input += message.usage.input;
    output += message.usage.output;
    cacheRead += message.usage.cacheRead;
    costTotal += message.usage.cost.total;
  }

  return { input, output, cacheRead, costTotal };
}

export function installUsageCustomFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        const cwdBase = normalizeCwd(ctx.cwd);
        const branch = footerData.getGitBranch();
        const cwdWithBranch = branch ? `${cwdBase} (${branch})` : cwdBase;

        const line1Left = theme.fg("dim", cwdWithBranch);
        const line1Right = theme.fg("dim", getThinkingSummary(ctx, pi));
        const line1 = truncateToWidth(
          alignLeftRight(width, line1Left, line1Right),
          width,
          theme.fg("dim", "..."),
        );

        const usage = sumAssistantUsage(ctx);
        const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
        const costLabel = `$${usage.costTotal.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;

        const context = ctx.getContextUsage();
        const contextPercent = context?.percent ?? null;
        const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow ?? 0;
        const contextPercentText = contextPercent === null ? "?" : `${contextPercent.toFixed(1)}%`;
        const contextBar = renderTinyBar(contextPercent, 10);
        const contextSegment = `${contextBar} ${contextPercentText}/${formatTokens(contextWindow)}`;

        const leftSuffix = `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)} R${formatTokens(usage.cacheRead)} ${costLabel}`;
        const line2Left = `${contextSegment} ${theme.fg("dim", leftSuffix)}`;

        const statuses = footerData.getExtensionStatuses();
        const quotaStatus = statuses.get(FOOTER_STATUS_KEY) ?? "";
        const line2Right = quotaStatus;

        const line2 = truncateToWidth(alignLeftRight(width, line2Left, line2Right), width, "...");

        return [line1, line2];
      },
    };
  });
}

export function uninstallUsageCustomFooter(ctx: ExtensionContext): void {
  ctx.ui.setFooter(undefined);
}
