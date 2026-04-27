import { renderViewerHtml } from "./html";
import { handleViewerAssetRequest } from "./viewer-assets";
import {
  dispatchReviewSubmit,
  getReviewContext,
  markReviewSubmitted,
  type ReviewContext,
  touchReviewContext,
} from "./review-registry";
import { validateCommentPayload } from "../domain/comments";
import type { CommentSubmitPayload } from "../domain/types";

interface PayloadValidationResult {
  valid: boolean;
  payload?: CommentSubmitPayload;
  error?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function validateSubmitPayload(value: unknown): PayloadValidationResult {
  return validateCommentPayload(value);
}

function extractReviewToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/review\/([^/]+)\/?$/);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

function extractSubmitToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/review\/([^/]+)\/submit\/?$/);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

function extractApiReviewToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/review\/([^/]+)\/?$/);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

function extractDataToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/review\/([^/]+)\/data\/?$/);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

function buildBootstrap(context: ReviewContext) {
  return {
    token: context.token,
    status: context.status,
    target: context.target,
    fileCount: context.payload.files.length,
    submitUrl: context.submitUrl,
  };
}

async function handleReviewHtml(token: string): Promise<Response> {
  const context = touchReviewContext(token);
  if (!context) {
    return new Response("Review not found", { status: 404 });
  }

  const bootstrap = buildBootstrap(context);

  return new Response(renderViewerHtml(JSON.stringify(bootstrap)), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleData(token: string): Promise<Response> {
  const context = touchReviewContext(token);
  if (!context) {
    return json({ ok: false, error: "review_not_found" }, 404);
  }

  return json(
    {
      ok: true,
      payload: context.payload,
    },
    200,
  );
}

async function handleSubmit(token: string, req: Request): Promise<Response> {
  const context = getReviewContext(token);
  if (!context) {
    return json({ ok: false, error: "review_not_found" }, 404);
  }

  if (context.status !== "active") {
    return json({ ok: false, error: "review_not_active" }, 409);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const validated = validateSubmitPayload(body);
  if (!validated.valid || !validated.payload) {
    return json({ ok: false, error: validated.error ?? "invalid_payload" }, 400);
  }

  try {
    await dispatchReviewSubmit(token, validated.payload);
    markReviewSubmitted(token);
    return json({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "submit_failed";
    return json({ ok: false, error: message }, 500);
  }
}

export async function handleReviewServerRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const viewerAssetResponse = await handleViewerAssetRequest(url.pathname);
    if (viewerAssetResponse) {
      return viewerAssetResponse;
    }
    const token = extractReviewToken(url.pathname);
    if (token) {
      return handleReviewHtml(token);
    }

    const dataToken = extractDataToken(url.pathname);
    if (dataToken) {
      return handleData(dataToken);
    }

    const apiToken = extractApiReviewToken(url.pathname);
    if (apiToken) {
      const location = buildReviewRoute(apiToken);
      return new Response(null, {
        status: 307,
        headers: {
          location,
          "cache-control": "no-store",
        },
      });
    }
  }

  if (req.method === "POST") {
    const token = extractSubmitToken(url.pathname);
    if (token) {
      return handleSubmit(token, req);
    }
  }

  return new Response("Not Found", { status: 404 });
}

export function buildReviewRoute(token: string): string {
  return `/review/${encodeURIComponent(token)}`;
}

export function buildReviewDataRoute(token: string): string {
  return `/api/review/${encodeURIComponent(token)}/data`;
}

export function buildSubmitRoute(token: string): string {
  return `/api/review/${encodeURIComponent(token)}/submit`;
}
