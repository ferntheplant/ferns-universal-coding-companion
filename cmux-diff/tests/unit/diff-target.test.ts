import { describe, expect, test } from "bun:test";
import { parseDiffTargetSpec, validateDiffTarget } from "../../src/domain/diff-target";

describe("diff target parsing", () => {
  test("parses uncommitted", () => {
    expect(parseDiffTargetSpec("uncommitted")).toEqual({ kind: "uncommitted" });
  });

  test("parses branch and commit forms", () => {
    expect(parseDiffTargetSpec("branch:main")).toEqual({ kind: "branch", value: "main" });
    expect(parseDiffTargetSpec("commit:abc1234")).toEqual({ kind: "commit", value: "abc1234" });
  });

  test("validates non-empty values", () => {
    expect(validateDiffTarget({ kind: "branch", value: "" }).valid).toBe(false);
    expect(validateDiffTarget({ kind: "commit", value: "HEAD~1" }).valid).toBe(true);
  });
});
