import type {
  BeforeProviderRequestEvent,
  ContextEvent,
  ExtensionContext,
  ToolResultEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@mariozechner/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  captureAssistantMessageUpdate,
  captureContextSnapshot,
  captureMessageEnd,
  captureProviderRequest,
  captureProviderResponse,
  captureToolResult,
  captureTurnEnd,
  flushPendingTurn,
  getSpikeDir,
  markCapturePosted,
  markPostFailure,
  markTurnPersisted,
  markWriteFailure,
  type MessageEndEventLike,
  type MessageUpdateEventLike,
  type ProviderResponseEventLike,
  type SpikeTurnRecord,
  startTurnCapture,
} from "./runtime";
import { ensureSidecarRunning } from "./server-manager";

const PI_INGEST_URL = "http://127.0.0.1:4041/api/ingest/pi";

async function persistRecord(record: SpikeTurnRecord): Promise<void> {
  await mkdir(getSpikeDir(), { recursive: true });
  await mkdir(dirname(record.outputPath), { recursive: true });
  await writeFile(record.outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  markTurnPersisted();
}

async function persistIfPresent(record: SpikeTurnRecord | null, ctx: ExtensionContext): Promise<void> {
  if (!record) return;

  try {
    await ensureSidecarRunning();
    const response = await fetch(PI_INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
    }
    markCapturePosted();
  } catch (error) {
    markPostFailure();
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`pi-context failed to post ingest payload: ${message}`, "warning");
  }

  try {
    await persistRecord(record);
  } catch (error) {
    markWriteFailure();
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`pi-context failed to write spike fixture: ${message}`, "error");
  }
}

export function handleTurnStart(event: TurnStartEvent, ctx: ExtensionContext): void {
  startTurnCapture(event, ctx);
}

export function handleContext(event: ContextEvent, ctx: ExtensionContext): void {
  captureContextSnapshot(event, ctx);
}

export function handleBeforeProviderRequest(event: BeforeProviderRequestEvent, ctx: ExtensionContext): void {
  captureProviderRequest(event, ctx);
}

export function handleAfterProviderResponse(event: ProviderResponseEventLike, ctx: ExtensionContext): void {
  captureProviderResponse(event, ctx);
}

export function handleMessageUpdate(event: MessageUpdateEventLike, ctx: ExtensionContext): void {
  captureAssistantMessageUpdate(event, ctx);
}

export function handleMessageEnd(event: MessageEndEventLike, ctx: ExtensionContext): void {
  captureMessageEnd(event, ctx);
}

export function handleToolResult(event: ToolResultEvent, ctx: ExtensionContext): void {
  captureToolResult(event, ctx);
}

export async function handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
  await persistIfPresent(captureTurnEnd(event, ctx), ctx);
}

export async function handleSessionFlush(
  ctx: ExtensionContext,
  reason: "session_shutdown" | "reset",
): Promise<void> {
  await persistIfPresent(flushPendingTurn(ctx, reason), ctx);
}
