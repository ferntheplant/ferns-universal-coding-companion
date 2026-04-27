import type { PrivacyLevel } from "./context-lens/types.js";

const VALID_PRIVACY_LEVELS = new Set<PrivacyLevel>(["minimal", "standard", "full"]);

export function resolvePrivacyLevel(): PrivacyLevel {
  const raw = process.env.PI_CONTEXT_PRIVACY?.trim().toLowerCase();
  if (!raw) return "standard";
  if (VALID_PRIVACY_LEVELS.has(raw as PrivacyLevel)) {
    return raw as PrivacyLevel;
  }

  console.warn(
    `Invalid PI_CONTEXT_PRIVACY value "${process.env.PI_CONTEXT_PRIVACY}", using "standard"`,
  );
  return "standard";
}
