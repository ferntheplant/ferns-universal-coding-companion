import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { CommentDraft, CommentScope } from "../../domain/types";

export interface FileCommentDraft {
  summary: string;
}

export interface LineCommentDraft {
  line: number;
  text: string;
}

// ============================================================================
// File-level comment atoms
// ============================================================================

export const commentsByFileAtom = atom<Record<string, FileCommentDraft>>({});

const emptyDraft: FileCommentDraft = { summary: "" };

export const fileCommentAtomFamily = atomFamily((fileId: string) =>
  atom(
    (get) => get(commentsByFileAtom)[fileId] ?? emptyDraft,
    (get, set, next: FileCommentDraft) => {
      const current = get(commentsByFileAtom);
      set(commentsByFileAtom, {
        ...current,
        [fileId]: next,
      });
    },
  ),
);

export const fileCommentTextAtomFamily = atomFamily((fileId: string) =>
  atom(
    (get) => get(fileCommentAtomFamily(fileId)).summary,
    (get, set, text: string) => {
      const previous = get(fileCommentAtomFamily(fileId));
      set(fileCommentAtomFamily(fileId), {
        ...previous,
        summary: text,
      });
    },
  ),
);

// ============================================================================
// Overall comment atom
// ============================================================================

export const overallCommentAtom = atom<string>("");

// ============================================================================
// Line-level comment atoms (keyed by fileId:lineNumber)
// ============================================================================

export const lineCommentsByKeyAtom = atom<Record<string, string>>({});

function buildLineCommentKey(fileId: string, line: number): string {
  return `${fileId}:${line}`;
}

export const lineCommentAtomFamily = atomFamily((key: string) =>
  atom(
    (get) => get(lineCommentsByKeyAtom)[key] ?? "",
    (get, set, text: string) => {
      const current = get(lineCommentsByKeyAtom);
      set(lineCommentsByKeyAtom, {
        ...current,
        [key]: text,
      });
    },
  ),
);

export function getLineCommentAtom(fileId: string, line: number) {
  return lineCommentAtomFamily(buildLineCommentKey(fileId, line));
}

// ============================================================================
// Derived counts
// ============================================================================

export const totalDraftCommentCountAtom = atom((get) => {
  let count = 0;

  // Count file comments
  const fileComments = get(commentsByFileAtom);
  for (const draft of Object.values(fileComments)) {
    if (draft.summary.trim().length > 0) count++;
  }

  // Count overall comment
  if (get(overallCommentAtom).trim().length > 0) count++;

  // Count line comments
  const lineComments = get(lineCommentsByKeyAtom);
  for (const text of Object.values(lineComments)) {
    if (text.trim().length > 0) count++;
  }

  return count;
});

export const hasAnyCommentsAtom = atom((get) => get(totalDraftCommentCountAtom) > 0);

// Count comments for a specific file (file-level + line comments)
export const fileCommentCountAtomFamily = atomFamily((fileId: string) =>
  atom((get) => {
    let count = 0;

    // Count file-level comment
    const fileComments = get(commentsByFileAtom);
    const fileDraft = fileComments[fileId];
    if ((fileDraft?.summary?.trim().length ?? 0) > 0) {
      count++;
    }

    // Count line comments for this file
    const lineComments = get(lineCommentsByKeyAtom);
    const prefix = `${fileId}:`;
    for (const [key, text] of Object.entries(lineComments)) {
      if (key.startsWith(prefix) && (text?.trim().length ?? 0) > 0) {
        count++;
      }
    }

    return count;
  }),
);

// ============================================================================
// Build submission payload
// ============================================================================

export interface CommentBuildInput {
  files: Array<{ id: string; path: string }>;
  reviewToken: string;
}

export const buildSubmissionPayloadAtom = atom(null, (get, set, input: CommentBuildInput) => {
  const comments: CommentDraft[] = [];
  const now = Date.now();

  // Build overall comment
  const overallText = get(overallCommentAtom).trim();
  if (overallText.length > 0) {
    comments.push({
      id: `overall-${now}`,
      scope: "overall" as CommentScope,
      text: overallText,
      createdAt: now,
    });
  }

  // Build file comments
  const fileComments = get(commentsByFileAtom);
  for (const file of input.files) {
    const draft = fileComments[file.id];
    if (draft?.summary.trim()) {
      comments.push({
        id: `file-${file.id}-${now}`,
        scope: "file" as CommentScope,
        fileId: file.id,
        filePath: file.path,
        text: draft.summary.trim(),
        createdAt: now,
      });
    }
  }

  // Build line comments
  const lineComments = get(lineCommentsByKeyAtom);
  for (const [key, text] of Object.entries(lineComments)) {
    const trimmed = text.trim();
    if (!trimmed) continue;

    const match = key.match(/^([^:]+):(\d+)$/);
    if (!match) continue;

    const fileId = match[1];
    const lineStr = match[2];
    if (!fileId || !lineStr) continue;

    const line = parseInt(lineStr, 10);
    const file = input.files.find((f) => f.id === fileId);

    if (file) {
      comments.push({
        id: `line-${key}-${now}`,
        scope: "line" as CommentScope,
        fileId: file.id,
        filePath: file.path,
        line,
        text: trimmed,
        createdAt: now,
      });
    }
  }

  return {
    comments,
    submittedAt: now,
  };
});

// ============================================================================
// Clear all comments (after successful submission)
// ============================================================================

export const clearAllCommentsAtom = atom(null, (_get, set) => {
  set(commentsByFileAtom, {});
  set(overallCommentAtom, "");
  set(lineCommentsByKeyAtom, {});
});
