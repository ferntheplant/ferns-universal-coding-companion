import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveOAuthAccessToken } from "../auth/pi-auth";
import type { DashboardSection, ProviderAdapter, ProviderUsageResult } from "./types";

interface CodexUsagePayload {
  rate_limit?: {
    primary_window?: {
      used_percent?: number;
      reset_after_seconds?: number;
    };
    secondary_window?: {
      used_percent?: number;
      reset_after_seconds?: number;
    };
  };
}

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value >= 0 && value <= 1) {
    return Math.max(0, Math.min(100, value * 100));
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

function toCodexSections(payload: CodexUsagePayload): DashboardSection[] {
  const sessionUsed = clampPercent(payload.rate_limit?.primary_window?.used_percent ?? 0);
  const weeklyUsed = clampPercent(payload.rate_limit?.secondary_window?.used_percent ?? 0);

  const sessionResetSeconds = payload.rate_limit?.primary_window?.reset_after_seconds;
  const weeklyResetSeconds = payload.rate_limit?.secondary_window?.reset_after_seconds;

  const sections: DashboardSection[] = [
    {
      type: "percent_bar",
      label: "Weekly",
      percent: weeklyUsed,
    },
    {
      type: "percent_bar",
      label: "Session",
      percent: sessionUsed,
    },
  ];

  if (typeof weeklyResetSeconds === "number") {
    sections.push({
      type: "reset_timer",
      label: "Weekly resets in",
      value: formatDuration(weeklyResetSeconds),
    });
  }
  if (typeof sessionResetSeconds === "number") {
    sections.push({
      type: "reset_timer",
      label: "Session resets in",
      value: formatDuration(sessionResetSeconds),
    });
  }

  return sections;
}

async function fetchCodexPayload(ctx: ExtensionContext): Promise<CodexUsagePayload> {
  const token = await resolveOAuthAccessToken("openai-codex");
  if (!token.accessToken) {
    throw new Error("Codex is not authenticated in Pi. Run /login and authenticate openai-codex.");
  }

  const response = await fetch(CODEX_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
    },
    signal: ctx.signal,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Codex auth is expired or unauthorized. Re-run /login for openai-codex.");
  }

  if (!response.ok) {
    throw new Error(`Codex usage fetch failed (HTTP ${response.status}).`);
  }

  try {
    const payload = (await response.json()) as CodexUsagePayload;
    return payload;
  } catch {
    throw new Error("Codex usage response was not valid JSON.");
  }
}

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "OpenAI Codex",

  detectActive(modelProvider: string | undefined): boolean {
    return modelProvider === "openai-codex";
  },

  async isConfigured(_ctx: ExtensionContext): Promise<boolean> {
    const token = await resolveOAuthAccessToken("openai-codex");
    return Boolean(token.accessToken);
  },

  async fetchUsage(ctx: ExtensionContext): Promise<ProviderUsageResult> {
    const payload = await fetchCodexPayload(ctx);
    const sections = toCodexSections(payload);

    const session = sections.find((section) => section.type === "percent_bar" && section.label === "Session");
    const weekly = sections.find((section) => section.type === "percent_bar" && section.label === "Weekly");

    const sessionPercent = session?.type === "percent_bar" ? Math.round(session.percent) : 0;
    const weeklyPercent = weekly?.type === "percent_bar" ? Math.round(weekly.percent) : 0;

    const sessionReset = sections.find(
      (section) => section.type === "reset_timer" && section.label === "Session resets in",
    );
    const sessionResetCompact =
      sessionReset?.type === "reset_timer" ? compactDurationLabel(sessionReset.value) : "";

    return {
      providerId: "codex",
      providerLabel: "OpenAI Codex",
      fetchedAt: Date.now(),
      sections,
      footerText: `Codex W ${renderTinyBar(weeklyPercent)} ${weeklyPercent}% · S ${renderTinyBar(sessionPercent)} ${sessionPercent}%${sessionResetCompact ? ` ${sessionResetCompact}` : ""}`,
    };
  },

  renderFooter(result: ProviderUsageResult): string | null {
    return result.footerText;
  },

  renderDashboardSections(result: ProviderUsageResult): DashboardSection[] {
    return result.sections;
  },
};
