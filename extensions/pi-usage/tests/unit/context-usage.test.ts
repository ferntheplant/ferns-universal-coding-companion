import { describe, expect, it } from "bun:test";
import { createStickyContextUsageResolver } from "../../src/extension/ui/context-usage";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

function createContext(
  sessionId: string,
  modelId: string,
  provider = "google",
): ExtensionContext {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
    } as ExtensionContext["sessionManager"],
    model: {
      id: modelId,
      provider,
    } as ExtensionContext["model"],
  } as ExtensionContext;
}

describe("sticky context usage", () => {
  it("keeps last known usage when current usage drops to unknown", () => {
    const resolve = createStickyContextUsageResolver();
    const ctx = createContext("session-1", "gemini-3.1-pro");

    const first = resolve(ctx, { tokens: 1200, contextWindow: 1_048_576, percent: 0.114 });
    expect(first?.tokens).toBe(1200);

    const fallback = resolve(ctx, undefined);
    expect(fallback?.tokens).toBe(1200);
    expect(fallback?.percent).toBeCloseTo(0.114);
  });

  it("updates cache when new usage arrives for same session and model", () => {
    const resolve = createStickyContextUsageResolver();
    const ctx = createContext("session-1", "gemini-3.1-pro");

    resolve(ctx, { tokens: 100, contextWindow: 1_048_576, percent: 0.01 });
    const updated = resolve(ctx, { tokens: 900, contextWindow: 1_048_576, percent: 0.09 });

    expect(updated?.tokens).toBe(900);
    expect(updated?.percent).toBeCloseTo(0.09);
  });

  it("does not cross session or model boundaries", () => {
    const resolve = createStickyContextUsageResolver();
    const ctx1 = createContext("session-1", "gemini-3.1-pro");
    const ctx2 = createContext("session-2", "gemini-3.1-pro");
    const ctx3 = createContext("session-1", "gemini-2.5-pro");

    resolve(ctx1, { tokens: 100, contextWindow: 1_048_576, percent: 0.01 });

    expect(resolve(ctx2, undefined)).toBeUndefined();
    expect(resolve(ctx3, undefined)).toBeUndefined();
  });
});
