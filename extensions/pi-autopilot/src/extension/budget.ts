import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutopilotConfig } from "./config";
import type { RunState } from "./types";

/**
 * Budget + quota guard, consulted before every point where autopilot
 * INITIATES spend (injecting a fix prompt, spawning a QA agent). Never aborts
 * a turn mid-stream; breaches pause at the next tick.
 *
 * Checks, cheapest first:
 * 1. wall clock vs budget.maxWallClockMinutes
 * 2. accumulated tokens vs budget.maxTokensPerRun (summed on message_end)
 * 3. subscription quota vs config.quota thresholds, answered by pi-usage over
 *    the "usage:query" bus channel (pi-usage's cache keeps scrapers safe).
 *    Quota is fail-closed ONLY when thresholds are configured: no response,
 *    a missing provider, or an unparseable section all mean "unknown quota =
 *    assume near limit". An empty config.quota skips the check entirely.
 *
 * Context-percent (auto-compact-once) is handled at the agent_end tick in the
 * controller, not here — compaction needs the agent idle.
 */

export interface SpendCheck {
  ok: boolean;
  reason?: string;
}

interface UsageSection {
  type?: string;
  label?: string;
  percent?: number;
  value?: string;
}

interface UsageResult {
  providerId?: string;
  sections?: UsageSection[];
}

const QUERY_TIMEOUT_MS = 10_000;

function queryUsage(pi: ExtensionAPI, providerIds: string[]): Promise<UsageResult[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS);
    pi.events.emit("usage:query", {
      providerIds,
      respond: (results: unknown) => {
        clearTimeout(timer);
        resolve(Array.isArray(results) ? (results as UsageResult[]) : null);
      },
    });
  });
}

function parseDollars(value: string): number | null {
  const match = value.match(/([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]!.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function checkProviderQuota(
  providerId: string,
  threshold: { maxPercent?: number; minDollars?: number },
  result: UsageResult | undefined,
): string | null {
  if (!result?.sections) return `quota for "${providerId}" unavailable (assuming near limit)`;
  for (const section of result.sections) {
    if (
      threshold.maxPercent !== undefined &&
      section.type === "percent_bar" &&
      typeof section.percent === "number" &&
      section.percent >= threshold.maxPercent
    ) {
      return `${providerId} ${section.label ?? "usage"} at ${Math.round(section.percent)}% (limit ${threshold.maxPercent}%)`;
    }
    if (
      threshold.minDollars !== undefined &&
      section.type === "amount_remaining" &&
      typeof section.value === "string"
    ) {
      const dollars = parseDollars(section.value);
      if (dollars === null) return `quota for "${providerId}" unparseable (assuming near limit)`;
      if (dollars < threshold.minDollars) {
        return `${providerId} balance $${dollars.toFixed(2)} below $${threshold.minDollars}`;
      }
    }
  }
  return null;
}

export async function checkSpendAllowed(
  pi: ExtensionAPI,
  _ctx: ExtensionContext,
  config: AutopilotConfig,
  run: RunState,
): Promise<SpendCheck> {
  const elapsedMinutes = (Date.now() - run.armedAt) / 60_000;
  if (elapsedMinutes > config.budget.maxWallClockMinutes) {
    return {
      ok: false,
      reason: `run exceeded ${config.budget.maxWallClockMinutes}m wall clock`,
    };
  }

  if (run.tokensSpent > config.budget.maxTokensPerRun) {
    return {
      ok: false,
      reason: `run spent ${Math.round(run.tokensSpent / 1000)}k tokens (budget ${Math.round(config.budget.maxTokensPerRun / 1000)}k)`,
    };
  }

  const thresholds = Object.entries(config.quota);
  if (thresholds.length > 0) {
    const results = await queryUsage(
      pi,
      thresholds.map(([providerId]) => providerId),
    );
    if (results === null) {
      return {
        ok: false,
        reason: "quota query unanswered — is pi-usage loaded? (unknown quota = assume near limit)",
      };
    }
    for (const [providerId, threshold] of thresholds) {
      const breach = checkProviderQuota(
        providerId,
        threshold,
        results.find((result) => result.providerId === providerId),
      );
      if (breach) return { ok: false, reason: breach };
    }
  }

  return { ok: true };
}
