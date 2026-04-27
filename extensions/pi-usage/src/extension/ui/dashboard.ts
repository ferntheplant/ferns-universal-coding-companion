import type { DashboardSection, ProviderId, ProviderUsageResult } from "../providers/types";

export type DashboardProviderStatus = "loading" | "ready" | "error";

export interface DashboardProviderCard {
  providerId: ProviderId;
  providerLabel: string;
  isActive: boolean;
  status: DashboardProviderStatus;
  sections: DashboardSection[];
  errorMessage?: string;
}

export interface DashboardViewModel {
  providers: DashboardProviderCard[];
  fetchedAt: number;
}

export function createLoadingCard(
  providerId: ProviderId,
  providerLabel: string,
  isActive: boolean,
): DashboardProviderCard {
  return {
    providerId,
    providerLabel,
    isActive,
    status: "loading",
    sections: [{ type: "info_line", value: "Loading usage…" }],
  };
}

export function createErrorCard(
  providerId: ProviderId,
  providerLabel: string,
  isActive: boolean,
  errorMessage: string,
): DashboardProviderCard {
  return {
    providerId,
    providerLabel,
    isActive,
    status: "error",
    errorMessage,
    sections: [{ type: "error", message: errorMessage }],
  };
}

export function createReadyCard(
  result: ProviderUsageResult,
  isActive: boolean,
): DashboardProviderCard {
  return {
    providerId: result.providerId,
    providerLabel: result.providerLabel,
    isActive,
    status: "ready",
    sections: result.sections,
  };
}

export function buildDashboardViewModel(cards: DashboardProviderCard[]): DashboardViewModel {
  return {
    providers: cards,
    fetchedAt: Date.now(),
  };
}

function baseLabelForResetTimer(label: string): string | null {
  const suffix = " resets in";
  if (!label.endsWith(suffix)) {
    return null;
  }

  return label.slice(0, -suffix.length);
}

export function renderDashboardAsLines(model: DashboardViewModel): string[] {
  if (model.providers.length === 0) {
    return ["No supported usage providers are configured yet."];
  }

  const ready = model.providers.filter((provider) => provider.status === "ready").length;
  const errored = model.providers.filter((provider) => provider.status === "error").length;
  const lines: string[] = [];
  lines.push(
    `Usage dashboard (${ready}/${model.providers.length} healthy${errored > 0 ? `, ${errored} error` : ""})`,
  );
  for (const provider of model.providers) {
    const activeTag = provider.isActive ? " [active]" : "";
    lines.push(`${provider.providerLabel}${activeTag}`);
    const resetByBaseLabel = new Map<string, string>();
    for (const section of provider.sections) {
      if (section.type !== "reset_timer") {
        continue;
      }

      const baseLabel = baseLabelForResetTimer(section.label);
      if (baseLabel) {
        resetByBaseLabel.set(baseLabel, section.value);
      }
    }

    for (const section of provider.sections) {
      switch (section.type) {
        case "percent_bar": {
          const resetValue = resetByBaseLabel.get(section.label);
          const resetSuffix = resetValue ? ` resets in: ${resetValue}` : "";
          lines.push(
            `  - ${section.label}: ${section.percent.toFixed(1)}%${section.detail ? ` (${section.detail})` : ""}${resetSuffix}`,
          );
          break;
        }
        case "amount_remaining":
          lines.push(
            `  - ${section.label}: ${section.value}${section.detail ? ` (${section.detail})` : ""}`,
          );
          break;
        case "reset_timer": {
          const baseLabel = baseLabelForResetTimer(section.label);
          if (baseLabel && resetByBaseLabel.has(baseLabel)) {
            break;
          }
          lines.push(`  - ${section.label}: ${section.value}`);
          break;
        }
        case "info_line":
          lines.push(`  - ${section.label ? `${section.label}: ` : ""}${section.value}`);
          break;
        case "error":
          lines.push(`  - error: ${section.message}`);
          break;
      }
    }
  }
  return lines;
}
