import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveOAuthAccessToken } from "../auth/pi-auth";
import type { DashboardSection, ProviderAdapter, ProviderUsageResult } from "./types";

interface CursorUsagePayload {
  billingCycleStart?: string | number;
  billingCycleEnd?: string | number;
  enabled?: boolean;
  displayMessage?: string;
  planUsage?: {
    totalSpend?: number;
    includedSpend?: number;
    limit?: number;
    totalPercentUsed?: number;
    apiPercentUsed?: number;
    autoPercentUsed?: number;
  };
  spendLimitUsage?: {
    individualLimit?: number;
    individualRemaining?: number;
    limitType?: string;
  };
}

const CURSOR_USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "now";
  }

  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);

  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;

  return "<1m";
}

function renderTinyBar(percent: number, width = 8): string {
  const bounded = clampPercent(percent);
  const filled = Math.round((bounded / 100) * width);
  const full = "█".repeat(Math.max(0, Math.min(width, filled)));
  const empty = "░".repeat(Math.max(0, width - filled));
  return `${full}${empty}`;
}

function compactDurationLabel(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, "");
}

function toDollarsLabel(cents: number | undefined): string | undefined {
  if (!Number.isFinite(cents)) {
    return undefined;
  }
  return `$${((cents as number) / 100).toFixed(2)}`;
}

function toMillis(value: string | number | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toCursorSections(payload: CursorUsagePayload): DashboardSection[] {
  const totalUsed = clampPercent(payload.planUsage?.totalPercentUsed ?? 0);
  const apiUsed = clampPercent(payload.planUsage?.apiPercentUsed ?? 0);
  const autoUsedRaw = payload.planUsage?.autoPercentUsed;
  const autoUsed = typeof autoUsedRaw === "number" ? clampPercent(autoUsedRaw) : null;

  const sections: DashboardSection[] = [
    {
      type: "percent_bar",
      label: "Included total",
      percent: totalUsed,
    },
    {
      type: "percent_bar",
      label: "API included",
      percent: apiUsed,
    },
  ];

  if (typeof autoUsed === "number") {
    sections.push({
      type: "percent_bar",
      label: "Auto included",
      percent: autoUsed,
    });
  }

  const includedSpend = toDollarsLabel(payload.planUsage?.includedSpend);
  const includedLimit = toDollarsLabel(payload.planUsage?.limit);
  if (includedSpend && includedLimit) {
    sections.push({
      type: "info_line",
      label: "Included spend",
      value: `${includedSpend} / ${includedLimit}`,
    });
  }

  const demandLimit = toDollarsLabel(payload.spendLimitUsage?.individualLimit);
  if (demandLimit) {
    const limitType = payload.spendLimitUsage?.limitType ? ` (${payload.spendLimitUsage.limitType})` : "";
    sections.push({
      type: "info_line",
      label: "On-demand limit",
      value: `${demandLimit}${limitType}`,
    });
  }

  const billingCycleEndMs = toMillis(payload.billingCycleEnd);
  if (billingCycleEndMs !== null) {
    const resetIn = formatDuration((billingCycleEndMs - Date.now()) / 1000);
    sections.push({
      type: "reset_timer",
      label: "Billing cycle resets in",
      value: resetIn,
    });
  }

  if (typeof payload.enabled === "boolean" && !payload.enabled && payload.displayMessage) {
    sections.push({
      type: "info_line",
      label: "Status",
      value: payload.displayMessage,
    });
  }

  return sections;
}

async function fetchCursorPayload(ctx: ExtensionContext): Promise<CursorUsagePayload> {
  const token = await resolveOAuthAccessToken("cursor");
  if (!token.accessToken) {
    throw new Error("Cursor is not authenticated in Pi. Run /login and authenticate cursor.");
  }

  const response = await fetch(CURSOR_USAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: ctx.signal,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Cursor auth is expired or unauthorized. Re-run /login for cursor.");
  }

  if (!response.ok) {
    throw new Error(`Cursor usage fetch failed (HTTP ${response.status}).`);
  }

  try {
    return (await response.json()) as CursorUsagePayload;
  } catch {
    throw new Error("Cursor usage response was not valid JSON.");
  }
}

export const cursorProvider: ProviderAdapter = {
  id: "cursor",
  label: "Cursor",

  detectActive(modelProvider: string | undefined): boolean {
    return modelProvider === "cursor";
  },

  async isConfigured(_ctx: ExtensionContext): Promise<boolean> {
    const token = await resolveOAuthAccessToken("cursor");
    return Boolean(token.accessToken);
  },

  async fetchUsage(ctx: ExtensionContext): Promise<ProviderUsageResult> {
    const payload = await fetchCursorPayload(ctx);
    const sections = toCursorSections(payload);

    const totalSection = sections.find((section) => section.type === "percent_bar" && section.label === "Included total");
    const apiSection = sections.find((section) => section.type === "percent_bar" && section.label === "API included");
    const resetSection = sections.find(
      (section) => section.type === "reset_timer" && section.label === "Billing cycle resets in",
    );

    const totalPercent = totalSection?.type === "percent_bar" ? Math.round(totalSection.percent) : 0;
    const apiPercent = apiSection?.type === "percent_bar" ? Math.round(apiSection.percent) : 0;
    const resetCompact = resetSection?.type === "reset_timer" ? compactDurationLabel(resetSection.value) : "";

    return {
      providerId: "cursor",
      providerLabel: "Cursor",
      fetchedAt: Date.now(),
      sections,
      footerText: `Cursor T ${renderTinyBar(totalPercent)} ${totalPercent}% · A ${renderTinyBar(apiPercent)} ${apiPercent}%${resetCompact ? ` ${resetCompact}` : ""}`,
    };
  },

  renderFooter(result: ProviderUsageResult): string | null {
    return result.footerText;
  },

  renderDashboardSections(result: ProviderUsageResult): DashboardSection[] {
    return result.sections;
  },
};
