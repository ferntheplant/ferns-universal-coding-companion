import type { ReviewPayload, CommentSubmitPayload } from "../../domain/types";

interface ReviewDataSuccessResponse {
  ok: true;
  payload: ReviewPayload;
}

interface ReviewDataErrorResponse {
  ok: false;
  error: string;
}

type ReviewDataResponse = ReviewDataSuccessResponse | ReviewDataErrorResponse;

interface SubmitSuccessResponse {
  ok: true;
}

interface SubmitErrorResponse {
  ok: false;
  error: string;
}

type SubmitResponse = SubmitSuccessResponse | SubmitErrorResponse;

function buildReviewDataUrl(token: string): string {
  return `/api/review/${encodeURIComponent(token)}/data`;
}

export async function fetchReviewData(token: string): Promise<ReviewPayload> {
  const response = await fetch(buildReviewDataUrl(token), {
    method: "GET",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Review data request failed (${response.status})`);
  }

  const data = (await response.json()) as ReviewDataResponse;
  if (!data.ok) {
    throw new Error(data.error || "Unable to load review payload");
  }

  return data.payload;
}

export async function submitReviewComments(
  url: string,
  payload: CommentSubmitPayload,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Submission failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as SubmitResponse;
  if (!data.ok) {
    throw new Error(data.error || "Submission failed");
  }
}

// Legacy export for compatibility
export async function postReviewSubmission(url: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
