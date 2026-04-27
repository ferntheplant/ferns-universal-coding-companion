import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getZenAuthRecord, setZenAuthRecord, type ZenAuthRecord } from "../storage";

const BALANCE_MARKER = 'data-slot="balance-value"';

const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const IGNORED_COOKIE_PATTERNS: RegExp[] = [
  /^_ga/i,
  /^_gid/i,
  /^_gat/i,
  /^__utm/i,
  /^_fbp/i,
  /^ph_/i,
  /^ajs_/i,
  /^amplitude_/i,
  /^mp_/i,
  /^intercom/i,
];

export interface ParsedZenCurlRequest {
  url: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
}

export interface ZenValidationResult {
  ok: boolean;
  reason?: string;
  status?: number;
  html?: string;
}

function sanitizeMultilineCurl(input: string): string {
  return input
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function shellTokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (!ch) continue;

    if (quote === "single") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === "double") {
      if (ch === '"') {
        quote = null;
        continue;
      }

      if (ch === "\\") {
        const next = command[i + 1];
        if (next) {
          current += next;
          i += 1;
          continue;
        }
      }

      current += ch;
      continue;
    }

    if (ch === "'") {
      quote = "single";
      continue;
    }

    if (ch === '"') {
      quote = "double";
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (ch === "\\") {
      const next = command[i + 1];
      if (next) {
        current += next;
        i += 1;
        continue;
      }
    }

    current += ch;
  }

  if (quote) {
    throw new Error("The pasted curl command has unclosed quotes.");
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseHeaderToken(token: string): { name: string; value: string } {
  const separator = token.indexOf(":");
  if (separator <= 0) {
    throw new Error(`Malformed header: ${token}`);
  }

  const name = token.slice(0, separator).trim();
  const value = token.slice(separator + 1).trim();

  if (!name || !value) {
    throw new Error(`Malformed header: ${token}`);
  }

  return { name, value };
}

function extractCookies(cookieHeaderValue: string): Record<string, string> {
  const rawParts = cookieHeaderValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const cookies: Record<string, string> = {};

  for (const part of rawParts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (!name || !value || !COOKIE_NAME_PATTERN.test(name)) {
      continue;
    }

    if (IGNORED_COOKIE_PATTERNS.some((pattern) => pattern.test(name))) {
      continue;
    }

    cookies[name] = value;
  }

  return cookies;
}

function ensureHttpUrl(urlCandidate: string): string {
  try {
    const url = new URL(urlCandidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http(s) URLs are supported.");
    }
    return url.toString();
  } catch {
    throw new Error("Could not parse a valid dashboard URL from the pasted curl command.");
  }
}

function cookieHeaderFromRecord(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function parseZenCurlCommand(input: string): ParsedZenCurlRequest {
  const normalized = sanitizeMultilineCurl(input);
  if (!normalized) {
    throw new Error("Paste a full curl command copied from your browser devtools.");
  }

  const tokens = shellTokenize(normalized);
  if (tokens.length === 0 || tokens[0] !== "curl") {
    throw new Error("Input must start with `curl`.");
  }

  const headers: Record<string, string> = {};
  let url: string | null = null;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    if (token === "-H" || token === "--header") {
      const value = tokens[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}.`);
      }
      i += 1;
      const header = parseHeaderToken(value);
      headers[header.name.toLowerCase()] = header.value;
      continue;
    }

    if (token.startsWith("-H") && token.length > 2) {
      const header = parseHeaderToken(token.slice(2));
      headers[header.name.toLowerCase()] = header.value;
      continue;
    }

    if (token === "--url") {
      const value = tokens[i + 1];
      if (!value) {
        throw new Error("Missing value for --url.");
      }
      i += 1;
      url = value;
      continue;
    }

    if ((token.startsWith("http://") || token.startsWith("https://")) && !url) {
      url = token;
    }
  }

  if (!url) {
    throw new Error(
      "Could not find a URL in the pasted curl command. Copy the full request as curl from DevTools.",
    );
  }

  const resolvedUrl = ensureHttpUrl(url);
  const cookies = extractCookies(headers.cookie ?? "");

  if (Object.keys(cookies).length === 0) {
    throw new Error(
      "Could not extract cookies from the pasted request. Copy a logged-in Zen dashboard request that includes a Cookie header.",
    );
  }

  return {
    url: resolvedUrl,
    headers,
    cookies,
  };
}

export async function validateZenDashboardAuth(
  ctx: ExtensionContext,
  record: Pick<ZenAuthRecord, "dashboardUrl" | "cookies">,
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
      reason: "Zen dashboard rejected the cookies (unauthenticated).",
      status: response.status,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `Zen dashboard request failed with HTTP ${response.status}.`,
      status: response.status,
    };
  }

  const html = await response.text();

  if (!html.includes(BALANCE_MARKER)) {
    return {
      ok: false,
      reason:
        "Request succeeded but the Zen balance marker was missing. Make sure you copied a request from the logged-in dashboard page.",
      status: response.status,
    };
  }

  return {
    ok: true,
    status: response.status,
    html,
  };
}

export async function bootstrapZenAuthFromCurl(
  ctx: ExtensionCommandContext,
  curlText: string,
): Promise<{ record: ZenAuthRecord; validation: ZenValidationResult }> {
  const parsed = parseZenCurlCommand(curlText);

  const record: ZenAuthRecord = {
    dashboardUrl: parsed.url,
    cookies: parsed.cookies,
    updatedAt: Date.now(),
  };

  const validation = await validateZenDashboardAuth(ctx, record);
  if (!validation.ok) {
    throw new Error(validation.reason ?? "Zen auth validation failed.");
  }

  await setZenAuthRecord(record);
  return { record, validation };
}

export async function getStoredZenAuthStatus(ctx: ExtensionContext): Promise<
  | {
      configured: false;
      reason: string;
    }
  | {
      configured: true;
      record: ZenAuthRecord;
      validation: ZenValidationResult;
    }
> {
  const record = await getZenAuthRecord();
  if (!record) {
    return {
      configured: false,
      reason: "Zen dashboard auth is not configured yet. Run /usage-zen-login.",
    };
  }

  const validation = await validateZenDashboardAuth(ctx, record);
  if (!validation.ok) {
    return {
      configured: false,
      reason:
        validation.reason ??
        "Stored Zen dashboard auth is no longer valid. Re-run /usage-zen-login.",
    };
  }

  return {
    configured: true,
    record,
    validation,
  };
}
