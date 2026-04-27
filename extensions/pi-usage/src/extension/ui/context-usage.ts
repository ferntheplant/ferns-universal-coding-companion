import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ContextUsage } from "@mariozechner/pi-coding-agent";

interface CachedContextUsage {
  key: string;
  usage: ContextUsage;
}

function buildContextUsageKey(ctx: ExtensionContext): string {
  const sessionId = ctx.sessionManager.getSessionId();
  const provider = ctx.model?.provider ?? "";
  const modelId = ctx.model?.id ?? "";
  return `${sessionId}|${provider}|${modelId}`;
}

function isMeaningfulContextUsage(usage: ContextUsage): boolean {
  if (usage.tokens !== null && usage.tokens > 0) {
    return true;
  }

  return usage.percent !== null && usage.percent > 0;
}

export function createStickyContextUsageResolver(): (
  ctx: ExtensionContext,
  usage: ContextUsage | undefined,
) => ContextUsage | undefined {
  let cached: CachedContextUsage | undefined;

  return (ctx, usage) => {
    const key = buildContextUsageKey(ctx);

    if (usage && isMeaningfulContextUsage(usage)) {
      cached = { key, usage };
      return usage;
    }

    if (cached && cached.key === key) {
      return cached.usage;
    }

    return usage;
  };
}
