import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ProviderId = "codex" | "zen";

export type DashboardSection =
  | {
      type: "percent_bar";
      label: string;
      percent: number;
      detail?: string;
    }
  | {
      type: "amount_remaining";
      label: string;
      value: string;
      detail?: string;
    }
  | {
      type: "reset_timer";
      label: string;
      value: string;
    }
  | {
      type: "info_line";
      label?: string;
      value: string;
    }
  | {
      type: "error";
      message: string;
    };

export interface ProviderUsageResult {
  providerId: ProviderId;
  providerLabel: string;
  fetchedAt: number;
  sections: DashboardSection[];
  footerText: string | null;
}

export interface ProviderFetchOptions {
  forceRefresh?: boolean;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  detectActive(modelProvider: string | undefined): boolean;
  isConfigured(ctx: ExtensionContext): Promise<boolean>;
  fetchUsage(ctx: ExtensionContext, options?: ProviderFetchOptions): Promise<ProviderUsageResult>;
  renderFooter(result: ProviderUsageResult): string | null;
  renderDashboardSections(result: ProviderUsageResult): DashboardSection[];
}
