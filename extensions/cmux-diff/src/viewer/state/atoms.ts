import { atom } from "jotai";
import type { ReviewPayload } from "../../domain/types";

export type ViewerReviewStatus = "active" | "submitted" | "disposed";

export interface ViewerBootstrap {
  token: string | null;
  status: ViewerReviewStatus;
  target: string;
  fileCount: number;
  submitUrl: string | null;
}

export type ViewerLoadState = "idle" | "loading" | "ready" | "error";
export type SubmissionState = "idle" | "submitting" | "success" | "error";

export interface ViewerInitializeInput {
  bootstrap: ViewerBootstrap;
  payload?: ReviewPayload;
}

export const bootstrapAtom = atom<ViewerBootstrap | null>(null);
export const reviewPayloadAtom = atom<ReviewPayload | null>(null);
export const viewerLoadStateAtom = atom<ViewerLoadState>("idle");
export const viewerErrorAtom = atom<string | null>(null);

// Submission state atoms
export const submissionStateAtom = atom<SubmissionState>("idle");
export const submissionErrorAtom = atom<string | null>(null);

// Derived atoms
export const reviewTokenAtom = atom((get) => get(bootstrapAtom)?.token ?? null);
export const reviewStatusAtom = atom((get) => get(bootstrapAtom)?.status ?? "disposed");
export const targetLabelAtom = atom((get) => get(bootstrapAtom)?.target ?? "Unknown target");
export const fileCountAtom = atom((get) => get(reviewPayloadAtom)?.files.length ?? get(bootstrapAtom)?.fileCount ?? 0);
export const submitUrlAtom = atom((get) => get(bootstrapAtom)?.submitUrl ?? null);
export const canSubmitAtom = atom((get) => {
  const status = get(reviewStatusAtom);
  const submissionState = get(submissionStateAtom);
  return status === "active" && submissionState !== "submitting" && submissionState !== "success";
});

export const initializeViewerAtom = atom(null, (_get, set, input: ViewerInitializeInput) => {
  set(bootstrapAtom, input.bootstrap);
  if (input.payload) {
    set(reviewPayloadAtom, input.payload);
    set(viewerLoadStateAtom, "ready");
    set(viewerErrorAtom, null);
    return;
  }

  set(reviewPayloadAtom, null);
  set(viewerLoadStateAtom, "idle");
  set(viewerErrorAtom, null);
});

export const setSubmissionSuccessAtom = atom(null, (_get, set) => {
  set(submissionStateAtom, "success");
  set(submissionErrorAtom, null);
  set(bootstrapAtom, (prev) => (prev ? { ...prev, status: "submitted" } : prev));
});

export const setSubmissionErrorAtom = atom(null, (get, set, error: string) => {
  set(submissionStateAtom, "error");
  set(submissionErrorAtom, error);
});

export const resetSubmissionStateAtom = atom(null, (_get, set) => {
  set(submissionStateAtom, "idle");
  set(submissionErrorAtom, null);
});

export const startSubmissionAtom = atom(null, (_get, set) => {
  set(submissionStateAtom, "submitting");
  set(submissionErrorAtom, null);
});
