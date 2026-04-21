import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { validateZenDashboardAuth } from "../auth/zen-auth";
import { getZenAuthRecord, type ZenAuthRecord } from "../storage";
import type { DashboardSection, ProviderAdapter, ProviderUsageResult } from "./types";

const BALANCE_VALUE_REGEX = /data-slot="balance-value"[^>]*>([\s\S]*?)<\/[^>]+>/i;

function compactAge(updatedAt: number): string {
  const ageMs = Date.now() - updatedAt;
  const minutes = Math.floor(ageMs / 60_000);

  if (minutes <= 0) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function extractBalanceFromHtml(html: string): string | null {
  const marker = BALANCE_VALUE_REGEX.exec(html);
  if (!marker || !marker[1]) {
    return null;
  }

  const raw = marker[1]
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!raw) {
    return null;
  }

  const normalized = raw.startsWith("$") ? raw : `$${raw}`;
  if (!/^\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function buildUnauthenticatedResult(reason: string): ProviderUsageResult {
  return {
    providerId: "zen",
    providerLabel: "OpenCode Zen",
    fetchedAt: Date.now(),
    footerText: null,
    sections: [
      {
        type: "error",
        message: `${reason} Re-run /usage-zen-login.`,
      },
    ],
  };
}

async function requireZenAuthRecord(): Promise<ZenAuthRecord> {
  const record = await getZenAuthRecord();
  if (!record || Object.keys(record.cookies).length === 0) {
    throw new Error("Zen dashboard auth is not configured. Run /usage-zen-login.");
  }

  return record;
}

export const zenProvider: ProviderAdapter = {
  id: "zen",
  label: "OpenCode Zen",

  detectActive(modelProvider: string | undefined): boolean {
    return modelProvider === "opencode" || modelProvider === "opencode-go";
  },

  async isConfigured(_ctx: ExtensionContext): Promise<boolean> {
    const record = await getZenAuthRecord();
    return Boolean(record && Object.keys(record.cookies).length > 0);
  },

  async fetchUsage(ctx: ExtensionContext): Promise<ProviderUsageResult> {
    const record = await requireZenAuthRecord();
    const validation = await validateZenDashboardAuth(ctx, {
      dashboardUrl: record.dashboardUrl,
      cookies: record.cookies,
    });

    if (!validation.ok || !validation.html) {
      return buildUnauthenticatedResult(
        validation.reason ?? "Zen dashboard auth failed.",
      );
    }

    const balance = extractBalanceFromHtml(validation.html);
    if (!balance) {
      return {
        providerId: "zen",
        providerLabel: "OpenCode Zen",
        fetchedAt: Date.now(),
        footerText: null,
        sections: [
          {
            type: "error",
            message:
              "Zen dashboard response did not include a parseable balance. Re-run /usage-zen-login and retry.",
          },
        ],
      };
    }

    const sections: DashboardSection[] = [
      {
        type: "amount_remaining",
        label: "Balance",
        value: balance,
        detail: compactAge(record.updatedAt),
      },
    ];

    return {
      providerId: "zen",
      providerLabel: "OpenCode Zen",
      fetchedAt: Date.now(),
      footerText: `Zen balance ${balance}`,
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
