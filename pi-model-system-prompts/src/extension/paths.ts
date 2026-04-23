import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(extensionDir, "../..");
export const modelPromptsDir = resolve(repoRoot, "model-prompts");

export const MODEL_SELECTOR_PATTERN = /^(?:[^*/\s]+\/[^*/\s]+|[^*/\s]+\/\*|\*\/[^*/\s]+)$/;

export function toModelKey(provider: string, modelId: string): string {
  if (provider.length === 0) {
    throw new Error("provider must not be empty");
  }

  if (modelId.length === 0) {
    throw new Error("modelId must not be empty");
  }

  return `${provider}/${modelId}`;
}

export function isValidModelSelector(selector: string): boolean {
  if (selector === "*/*") {
    return false;
  }

  return MODEL_SELECTOR_PATTERN.test(selector);
}

export function matchesModelSelector(modelKey: string, selector: string): boolean {
  if (!isValidModelSelector(selector)) {
    return false;
  }

  if (selector === modelKey) {
    return true;
  }

  const [selectorProvider, selectorModelId] = selector.split("/");
  const [provider, modelId] = modelKey.split("/");

  if (!selectorProvider || !selectorModelId || !provider || !modelId) {
    return false;
  }

  if (selectorModelId === "*") {
    return selectorProvider === provider;
  }

  if (selectorProvider === "*") {
    return selectorModelId === modelId;
  }

  return false;
}
