import { createRoot } from "react-dom/client";
import { Provider } from "jotai";
import { App } from "./app";
import type { ReviewPayload } from "../domain/types";
import type { ViewerBootstrap, ViewerReviewStatus } from "./state/atoms";

function coerceStatus(value: unknown): ViewerReviewStatus {
  if (value === "active" || value === "submitted" || value === "disposed") {
    return value;
  }

  return "disposed";
}

function readBootstrap(): ViewerBootstrap {
  const value = window.__CMUX_DIFF_BOOTSTRAP__;
  if (!value || typeof value !== "object") {
    return {
      token: null,
      status: "disposed",
      target: "Unknown target",
      fileCount: 0,
      submitUrl: null,
    };
  }

  const record = value as Record<string, unknown>;

  return {
    token: typeof record.token === "string" ? record.token : null,
    status: coerceStatus(record.status),
    target: typeof record.target === "string" ? record.target : "Unknown target",
    fileCount: typeof record.fileCount === "number" ? record.fileCount : 0,
    submitUrl: typeof record.submitUrl === "string" ? record.submitUrl : null,
  };
}

function readMockPayload(): ReviewPayload | undefined {
  const value = window.__CMUX_DIFF_PAYLOAD__;
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as ReviewPayload;
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <Provider>
      <App bootstrap={readBootstrap()} initialPayload={readMockPayload()} />
    </Provider>,
  );
}
