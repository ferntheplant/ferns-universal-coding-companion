import { parsePatchFiles, processFile, type FileDiffMetadata, type ParsedPatch } from "@pierre/diffs";
import type { ReviewFile } from "../../domain/types";

export interface ParsedReviewFileDiff {
  fileDiff: FileDiffMetadata | null;
  error: string | null;
}

const GIT_DIFF_HEADER_RE = /^diff --git\s+/m;
const HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m;
const OLD_FILE_HEADER_RE = /^---\s+/m;
const NEW_FILE_HEADER_RE = /^\+\+\+\s+/m;

export function parseReviewFileDiff(file: ReviewFile): ParsedReviewFileDiff {
  const normalizedPath = typeof file.path === "string" ? file.path : "(unknown-file)";
  const patchText = normalizePatchText(file.patch, normalizedPath);
  if (!patchText.trim()) {
    return { fileDiff: null, error: null };
  }

  const candidates = buildPatchCandidates(normalizedPath, patchText);
  for (const candidate of candidates) {
    const direct = parseWithProcessFile(file, normalizedPath, candidate);
    if (direct) {
      return { fileDiff: withNameFallback(direct, normalizedPath), error: null };
    }
    const fromPatch = parseWithPatchFiles(normalizedPath, file.fingerprint, candidate);
    if (fromPatch) {
      return { fileDiff: withNameFallback(fromPatch, normalizedPath), error: null };
    }
  }
  return {
    fileDiff: null,
    error: "This patch could not be parsed by git-diff-view.",
  };
}

function normalizePatchText(value: unknown, normalizedPath: string): string {
  if (typeof value !== "string") {
    return "";
  }

  const unixPatch = value.replace(/\r\n/g, "\n");
  return canonicalizeGitFileHeaders(unixPatch, normalizedPath);
}

function buildPatchCandidates(path: string, patchText: string): string[] {
  const candidates = [patchText];

  if (!GIT_DIFF_HEADER_RE.test(patchText) && HUNK_HEADER_RE.test(patchText)) {
    const synthetic = wrapInSyntheticGitPatch(path, patchText);
    candidates.push(synthetic);
  }

  return dedupe(candidates);
}

function parseWithProcessFile(file: ReviewFile, normalizedPath: string, patchText: string): FileDiffMetadata | null {
  const cacheKey = typeof file.fingerprint === "string" ? file.fingerprint : normalizedPath;
  const oldFile =
    typeof file.oldContent === "string"
      ? {
          name: normalizedPath,
          contents: file.oldContent,
        }
      : undefined;
  const newFile =
    typeof file.newContent === "string"
      ? {
          name: normalizedPath,
          contents: file.newContent,
        }
      : undefined;
  const asGitDiff = processFile(patchText, {
    cacheKey,
    isGitDiff: true,
    oldFile,
    newFile,
    throwOnError: false,
  });
  if (asGitDiff) {
    return asGitDiff;
  }
  return (
    processFile(patchText, {
      cacheKey,
      isGitDiff: false,
      oldFile,
      newFile,
      throwOnError: false,
    }) ?? null
  );
}

function parseWithPatchFiles(path: string, cacheKey: string, patchText: string): FileDiffMetadata | null {
  const patches = parsePatchFiles(patchText, cacheKey, false);
  const fileDiffs = flattenPatchFiles(patches);
  if (fileDiffs.length === 0) {
    return null;
  }

  const exact = fileDiffs.find((candidate) => candidate.name === path || candidate.prevName === path);
  if (exact) {
    return exact;
  }

  const withHunks = fileDiffs.find((candidate) => candidate.hunks.length > 0);
  return withHunks ?? fileDiffs[0] ?? null;
}

function flattenPatchFiles(patches: ParsedPatch[]): FileDiffMetadata[] {
  const files: FileDiffMetadata[] = [];
  for (const patch of patches) {
    for (const file of patch.files) {
      files.push(file);
    }
  }

  return files;
}

function wrapInSyntheticGitPatch(path: string, patchText: string): string {
  const safePath = (typeof path === "string" ? path : "(unknown-file)").replace(/\s+/g, " ").trim();
  const oldHeader = OLD_FILE_HEADER_RE.test(patchText) ? "" : `--- a/${safePath}\n`;
  const newHeader = NEW_FILE_HEADER_RE.test(patchText) ? "" : `+++ b/${safePath}\n`;

  return [`diff --git a/${safePath} b/${safePath}`, oldHeader + newHeader + patchText].join("\n");
}

function canonicalizeGitFileHeaders(patchText: string, normalizedPath: string): string {
  const lines = patchText.split("\n");
  const nextLines = lines.map((line) => {
    if (line.startsWith("diff --git ")) {
      return `diff --git a/${normalizedPath} b/${normalizedPath}`;
    }

    if (line.startsWith("--- ") && line !== "--- /dev/null") {
      return `--- a/${normalizedPath}`;
    }

    if (line.startsWith("+++ ") && line !== "+++ /dev/null") {
      return `+++ b/${normalizedPath}`;
    }

    return line;
  });

  return nextLines.join("\n");
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function withNameFallback(fileDiff: FileDiffMetadata, fallbackPath: string): FileDiffMetadata {
  if (typeof fileDiff.name === "string" && fileDiff.name.trim().length > 0) {
    return fileDiff;
  }
  return {
    ...fileDiff,
    name: fallbackPath,
  };
}
