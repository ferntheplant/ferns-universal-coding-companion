import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  cookieHeaderFromRecord,
  parseZenCurlCommand,
  type ParsedZenCurlRequest,
  type ZenValidationResult,
} from "./zen-auth";
import { getGoAuthRecord, setGoAuthRecord, type GoAuthRecord } from "../storage";

const GO_USAGE_MARKER = 'data-slot="usage-item"';

export async function validateGoDashboardAuth(
  ctx: ExtensionContext,
  record: Pick<GoAuthRecord, "dashboardUrl" | "cookies">,
): Promise<ZenValidationResult> {
  const cookieHeader = cookieHeaderFromRecord(record.cookies);
  if (!cookieHeader) {
    return { ok: false, reason: "No cookies were available to validate." };
  }

  const response = await fetch(record.dashboardUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      cookie: cookieHeader,
      accept: "text/html,application/xhtml+xml",
      "accept-encoding": "identity",
      "user-agent": "pi-usage/1.0",
    },
    signal: ctx.signal,
  });

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "Go dashboard rejected the cookies (unauthenticated).",
      status: response.status,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `Go dashboard request failed with HTTP ${response.status}.`,
      status: response.status,
    };
  }

  const html = await response.text();

  if (!html.includes(GO_USAGE_MARKER)) {
    return {
      ok: false,
      reason:
        "Request succeeded but the Go usage marker was missing. Make sure you copied a request from the Go dashboard page (URL ending in /go).",
      status: response.status,
    };
  }

  return {
    ok: true,
    status: response.status,
    html,
  };
}

export async function bootstrapGoAuthFromCurl(
  ctx: ExtensionCommandContext,
  curlText: string,
): Promise<{ record: GoAuthRecord; validation: ZenValidationResult }> {
  const parsed = parseZenCurlCommand(curlText);

  const record: GoAuthRecord = {
    dashboardUrl: parsed.url,
    cookies: parsed.cookies,
    updatedAt: Date.now(),
  };

  const validation = await validateGoDashboardAuth(ctx, record);
  if (!validation.ok) {
    throw new Error(validation.reason ?? "Go auth validation failed.");
  }

  await setGoAuthRecord(record);
  return { record, validation };
}

export async function getStoredGoAuthStatus(ctx: ExtensionContext): Promise<
  | {
      configured: false;
      reason: string;
    }
  | {
      configured: true;
      record: GoAuthRecord;
      validation: ZenValidationResult;
    }
> {
  const record = await getGoAuthRecord();
  if (!record) {
    return {
      configured: false,
      reason: "Go dashboard auth is not configured yet. Run /usage-go-login.",
    };
  }

  const validation = await validateGoDashboardAuth(ctx, record);
  if (!validation.ok) {
    return {
      configured: false,
      reason:
        validation.reason ??
        "Stored Go dashboard auth is no longer valid. Re-run /usage-go-login.",
    };
  }

  return {
    configured: true,
    record,
    validation,
  };
}
