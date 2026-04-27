import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CommentDraft, CommentSubmitPayload, CommentScope } from "./types";

// ============================================================================
// TypeBox Schemas for validation
// ============================================================================

export const CommentScopeSchema = Type.Union(
  [Type.Literal("overall"), Type.Literal("file"), Type.Literal("line")],
  { default: "file" },
);

export const CommentDraftSchema = Type.Object({
  id: Type.String(),
  scope: CommentScopeSchema,
  fileId: Type.Optional(Type.String()),
  filePath: Type.Optional(Type.String()),
  line: Type.Optional(Type.Integer()),
  text: Type.String({ minLength: 1 }),
  createdAt: Type.Integer(),
});

export const CommentSubmitPayloadSchema = Type.Object({
  comments: Type.Array(CommentDraftSchema),
  submittedAt: Type.Integer(),
});

export type CommentSubmitPayloadValidated = Static<typeof CommentSubmitPayloadSchema>;

// ============================================================================
// Validation
// ============================================================================

export function validateCommentPayload(
  value: unknown,
): { valid: true; payload: CommentSubmitPayload } | { valid: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, error: "Payload must be a JSON object." };
  }

  const payload = value as Record<string, unknown>;

  if (!Array.isArray(payload.comments)) {
    return { valid: false, error: "Payload.comments must be an array." };
  }

  if (typeof payload.submittedAt !== "number") {
    return { valid: false, error: "Payload.submittedAt must be a number." };
  }

  for (let i = 0; i < payload.comments.length; i++) {
    const comment = payload.comments[i];
    if (typeof comment !== "object" || comment === null) {
      return { valid: false, error: `Comment at index ${i} must be an object.` };
    }

    const c = comment as Record<string, unknown>;

    if (typeof c.id !== "string") {
      return { valid: false, error: `Comment at index ${i} must have a string id.` };
    }

    if (!["overall", "file", "line"].includes(c.scope as string)) {
      return { valid: false, error: `Comment at index ${i} must have a valid scope.` };
    }

    if (typeof c.text !== "string" || c.text.length === 0) {
      return { valid: false, error: `Comment at index ${i} must have non-empty text.` };
    }

    if (typeof c.createdAt !== "number") {
      return { valid: false, error: `Comment at index ${i} must have createdAt timestamp.` };
    }
  }

  return { valid: true, payload: payload as unknown as CommentSubmitPayload };
}

// ============================================================================
// Formatting for Pi injection
// ============================================================================

function formatScopeLabel(scope: CommentScope): string {
  switch (scope) {
    case "overall":
      return "Overall";
    case "file":
      return "File";
    case "line":
      return "Line";
  }
}

function formatCommentForPi(comment: CommentDraft, index: number): string {
  const lines: string[] = [];

  lines.push(`## Comment ${index + 1} (${formatScopeLabel(comment.scope)})`);

  if (comment.filePath) {
    lines.push(`**File:** \`${comment.filePath}\``);
  }

  if (comment.line !== undefined) {
    lines.push(`**Line:** ${comment.line}`);
  }

  lines.push("");
  lines.push(comment.text);
  lines.push("");

  return lines.join("\n");
}

export function formatCommentsForPi(payload: CommentSubmitPayload): string {
  if (payload.comments.length === 0) {
    return "No comments submitted.";
  }

  const lines: string[] = [];

  lines.push("# cmux-diff Review Comments");
  lines.push("");
  lines.push(`**Submitted:** ${new Date(payload.submittedAt).toLocaleString()}`);
  lines.push(`**Total Comments:** ${payload.comments.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (let i = 0; i < payload.comments.length; i++) {
    const comment = payload.comments[i];
    if (!comment) continue;
    lines.push(formatCommentForPi(comment, i));
  }

  return lines.join("\n");
}

// ============================================================================
// Pi Editor Injection
// ============================================================================

export async function injectCommentsIntoPi(
  pi: ExtensionAPI,
  payload: CommentSubmitPayload,
  ctx: { ui: { setEditorText: (text: string) => void } },
): Promise<void> {
  const formatted = formatCommentsForPi(payload);
  // Insert the formatted comments into Pi's editor without sending
  // This allows the user to review and add more text before submitting
  ctx.ui.setEditorText(formatted);
}

// ============================================================================
// Grouping helpers for UI
// ============================================================================

export interface GroupedComments {
  overall: CommentDraft[];
  byFile: Map<string, CommentDraft[]>;
}

export function groupCommentsByScope(comments: CommentDraft[]): GroupedComments {
  const overall: CommentDraft[] = [];
  const byFile = new Map<string, CommentDraft[]>();

  for (const comment of comments) {
    if (comment.scope === "overall") {
      overall.push(comment);
      continue;
    }

    if (comment.fileId || comment.filePath) {
      const key = comment.fileId ?? comment.filePath ?? "unknown";
      const existing = byFile.get(key) ?? [];
      existing.push(comment);
      byFile.set(key, existing);
    }
  }

  return { overall, byFile };
}

export function countNonEmptyComments(comments: CommentDraft[]): number {
  return comments.filter((c) => c.text.trim().length > 0).length;
}
