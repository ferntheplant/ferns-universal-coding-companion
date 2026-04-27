import type { ReviewPayload, CommentSubmitPayload } from "../domain/types";

export type ReviewStatus = "active" | "submitted" | "disposed";

export interface ReviewContext {
  token: string;
  createdAt: number;
  lastAccessedAt: number;
  status: ReviewStatus;
  target: string;
  payload: ReviewPayload;
  submitUrl: string;
  onSubmit?: (payload: CommentSubmitPayload) => Promise<void> | void;
}

export interface CreateReviewContextInput {
  token: string;
  target: string;
  payload: ReviewPayload;
  submitUrl: string;
  onSubmit?: (payload: CommentSubmitPayload) => Promise<void> | void;
}

const reviewRegistry = new Map<string, ReviewContext>();

export function createReviewContext(input: CreateReviewContextInput): ReviewContext {
  const now = Date.now();
  const context: ReviewContext = {
    token: input.token,
    target: input.target,
    payload: input.payload,
    submitUrl: input.submitUrl,
    createdAt: now,
    lastAccessedAt: now,
    status: "active",
    onSubmit: input.onSubmit,
  };

  reviewRegistry.set(context.token, context);
  return context;
}

export function getReviewContext(token: string): ReviewContext | undefined {
  return reviewRegistry.get(token);
}

export function touchReviewContext(token: string): ReviewContext | undefined {
  const context = reviewRegistry.get(token);
  if (!context) {
    return undefined;
  }

  context.lastAccessedAt = Date.now();
  return context;
}

export function markReviewSubmitted(token: string): ReviewContext | undefined {
  const context = reviewRegistry.get(token);
  if (!context) {
    return undefined;
  }

  context.status = "submitted";
  context.lastAccessedAt = Date.now();
  return context;
}

export function disposeReviewContext(token: string): boolean {
  const context = reviewRegistry.get(token);
  if (!context) {
    return false;
  }

  context.status = "disposed";
  reviewRegistry.delete(token);
  return true;
}

export function clearReviewContexts(): void {
  reviewRegistry.clear();
}

export function listReviewContexts(): ReviewContext[] {
  return Array.from(reviewRegistry.values());
}

export function listActiveReviewContexts(): ReviewContext[] {
  return listReviewContexts().filter((context) => context.status === "active");
}

export function getActiveReviewTokens(): string[] {
  return listActiveReviewContexts().map((context) => context.token);
}

export async function dispatchReviewSubmit(
  token: string,
  payload: CommentSubmitPayload,
): Promise<void> {
  const context = reviewRegistry.get(token);
  if (!context) {
    throw new Error(`Unknown review token: ${token}`);
  }

  if (context.status !== "active") {
    throw new Error(`Review is not active: ${token}`);
  }

  context.lastAccessedAt = Date.now();
  await context.onSubmit?.(payload);
}
