import { describe, expect, test } from "bun:test";
import type { ReviewFile } from "../../src/domain/types";
import { parseReviewFileDiff } from "../../src/viewer/lib/diff-parser";

function makeReviewFile(patch: string): ReviewFile {
  return {
    id: "file-1",
    path: "src/example.ts",
    fingerprint: "fp-1",
    patch,
    additions: 1,
    deletions: 1,
  };
}

describe("parseReviewFileDiff", () => {
  test("parses a standard git patch", () => {
    const file = makeReviewFile(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
`);

    const parsed = parseReviewFileDiff(file);
    expect(parsed.error).toBeNull();
    expect(parsed.fileDiff).not.toBeNull();
    expect(parsed.fileDiff?.hunks.length).toBe(1);
  });

  test("parses git patches that use mnemonic prefixes", () => {
    const file = makeReviewFile(`diff --git c/src/example.ts w/src/example.ts
index 1111111..2222222 100644
--- c/src/example.ts
+++ w/src/example.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
`);

    const parsed = parseReviewFileDiff(file);
    expect(parsed.error).toBeNull();
    expect(parsed.fileDiff).not.toBeNull();
    expect(parsed.fileDiff?.name).toBe("src/example.ts");
  });

  test("parses hunk-only patch text via synthetic git wrapper", () => {
    const file = makeReviewFile(`@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
 const y = 3;
`);

    const parsed = parseReviewFileDiff(file);
    expect(parsed.error).toBeNull();
    expect(parsed.fileDiff).not.toBeNull();
    expect(parsed.fileDiff?.name).toBe("src/example.ts");
  });

  test("treats empty patch as non-error", () => {
    const parsed = parseReviewFileDiff(makeReviewFile("\n\n"));
    expect(parsed.error).toBeNull();
    expect(parsed.fileDiff).toBeNull();
  });
});
