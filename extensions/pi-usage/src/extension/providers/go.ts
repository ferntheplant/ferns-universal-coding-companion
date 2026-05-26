import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getGoAuthRecord, type GoAuthRecord } from "../storage";
import { validateGoDashboardAuth } from "../auth/go-auth";
import type { DashboardSection, ProviderAdapter, ProviderUsageResult } from "./types";

const USAGE_ITEM_REGEX = /data-slot="usage-item">([\s\S]*?)<\/div>\s*(?:<!--\/-->)?/gi;
const LABEL_REGEX = /data-slot="usage-label">([\s\S]*?)<\/span>/i;
const VALUE_REGEX = /data-slot="usage-value">([\s\S]*?)<\/span>/i;
const RESET_REGEX = /data-slot="reset-time">[\s\S]*?Resets in[\s\S]*?-->([\s\S]*?)<!--\/-->/i;

function stripHtmlComments(input: string): string {
  return input.replace(/<!--.*?-->/g, "");
}

function extractCleanText(input: string): string {
  return stripHtmlComments(input).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function renderTinyBar(percent: number, width = 8): string {
  const bounded = Math.max(0, Math.min(100, percent));
  const filled = Math.round((bounded / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function formatResetCompact(value: string | null): string {
  if (!value) return "";
  return value.replace(/\s+/g, "");
}

function parseGoUsageFromHtml(html: string): {
  rollingPercent: number;
  weeklyPercent: number;
  rollingReset: string | null;
  weeklyReset: string | null;
} {
  const items: Array<{ label: string; percent: number; reset: string | null }> = [];
  let match: RegExpExecArray | null;

  while ((match = USAGE_ITEM_REGEX.exec(html)) !== null) {
    const block = match[1];
    if (!block) continue;

    // extract label
    const labelMatch = block.match(LABEL_REGEX);
    if (!labelMatch) continue;
    const labelRaw = labelMatch[1];
    if (!labelRaw) continue;
    const label = extractCleanText(labelRaw);

    // extract percentage
    const valueMatch = block.match(VALUE_REGEX);
    const valueRaw = valueMatch ? valueMatch[1] : undefined;
    const valueText = valueRaw ? extractCleanText(valueRaw) : "0";
    const percent = parseFloat(valueText) || 0;

    // extract reset countdown
    const resetMatch = block.match(RESET_REGEX);
    let reset: string | null = null;
    if (resetMatch) {
      const resetRaw = resetMatch[1];
      if (resetRaw) {
        reset = resetRaw.replace(/<[^>]+>/g, "").trim();
      }
    }

    items.push({ label, percent, reset });
  }

  const rolling = items.find((i) => i.label === "Rolling Usage");
  const weekly = items.find((i) => i.label === "Weekly Usage");

  return {
    rollingPercent: rolling?.percent ?? 0,
    weeklyPercent: weekly?.percent ?? 0,
    rollingReset: rolling?.reset ?? null,
    weeklyReset: weekly?.reset ?? null,
  };
}

async function requireGoAuthRecord(): Promise<GoAuthRecord> {
  const record = await getGoAuthRecord();
  if (!record || Object.keys(record.cookies).length === 0) {
    throw new Error(
      "OpenCode Go dashboard auth is not configured. Run /usage-go-login.",
    );
  }
  return record;
}

function buildUnauthenticatedResult(reason: string): ProviderUsageResult {
  return {
    providerId: "go",
    providerLabel: "OpenCode Go",
    fetchedAt: Date.now(),
    footerText: null,
    sections: [
      {
        type: "error",
        message: `${reason} Re-run /usage-go-login.`,
      },
    ],
  };
}

export const goProvider: ProviderAdapter = {
  id: "go",
  label: "OpenCode Go",

  detectActive(modelProvider: string | undefined): boolean {
    return modelProvider === "opencode-go";
  },

  async isConfigured(_ctx: ExtensionContext): Promise<boolean> {
    const record = await getGoAuthRecord();
    return Boolean(record && Object.keys(record.cookies).length > 0);
  },

  async fetchUsage(ctx: ExtensionContext): Promise<ProviderUsageResult> {
    let record;
    try {
      record = await requireGoAuthRecord();
    } catch {
      return buildUnauthenticatedResult(
        "OpenCode Go dashboard auth is not configured.",
      );
    }

    const validation = await validateGoDashboardAuth(ctx, {
      dashboardUrl: record.dashboardUrl,
      cookies: record.cookies,
    });

    if (!validation.ok || !validation.html) {
      return buildUnauthenticatedResult(
        validation.reason ?? "Go dashboard auth failed.",
      );
    }

    const html = validation.html;

    const { rollingPercent, weeklyPercent, rollingReset, weeklyReset } =
      parseGoUsageFromHtml(html);

    const sections: DashboardSection[] = [
      {
        type: "percent_bar",
        label: "Rolling Usage",
        percent: rollingPercent,
      },
      {
        type: "percent_bar",
        label: "Weekly Usage",
        percent: weeklyPercent,
      },
    ];

    if (rollingReset) {
      sections.push({
        type: "reset_timer",
        label: "Rolling resets in",
        value: rollingReset,
      });
    }

    if (weeklyReset) {
      sections.push({
        type: "reset_timer",
        label: "Weekly resets in",
        value: weeklyReset,
      });
    }

    const rollingBar = renderTinyBar(rollingPercent);
    const weeklyBar = renderTinyBar(weeklyPercent);
    const rollingCompact = formatResetCompact(rollingReset);
    const weeklyCompact = formatResetCompact(weeklyReset);

    const footerText = `Go R ${rollingBar} ${Math.round(rollingPercent)}% · W ${weeklyBar} ${Math.round(weeklyPercent)}%${rollingCompact ? ` ${rollingCompact}` : ""}${weeklyCompact ? ` ${weeklyCompact}` : ""}`;

    return {
      providerId: "go",
      providerLabel: "OpenCode Go",
      fetchedAt: Date.now(),
      footerText,
      sections,
    };
  },

  renderFooter(result: ProviderUsageResult): string | null {
    return result.footerText;
  },

  renderDashboardSections(result: ProviderUsageResult): DashboardSection[] {
    return result.sections;
  },
};
