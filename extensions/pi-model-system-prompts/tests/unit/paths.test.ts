import { describe, expect, it } from "bun:test";
import { isValidModelSelector, matchesModelSelector } from "../../src/extension/paths";

describe("model selector parsing", () => {
  it("accepts global wildcard", () => {
    expect(isValidModelSelector("*/*")).toBe(true);
  });

  it("matches global wildcard against any model", () => {
    expect(matchesModelSelector("anthropic/claude-sonnet-4-5", "*/*")).toBe(true);
    expect(matchesModelSelector("openai/gpt-5", "*/*")).toBe(true);
  });

  it("keeps existing wildcard forms working", () => {
    expect(matchesModelSelector("anthropic/claude-sonnet-4-5", "anthropic/*")).toBe(true);
    expect(matchesModelSelector("anthropic/claude-sonnet-4-5", "*/claude-sonnet-4-5")).toBe(true);
    expect(matchesModelSelector("openai/gpt-5", "anthropic/*")).toBe(false);
  });
});
