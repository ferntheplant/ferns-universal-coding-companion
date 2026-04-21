import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type PiOAuthProviderId = "openai-codex" | "anthropic" | "google-gemini-cli" | "google-antigravity";

export interface PiOAuthCredential {
  access?: string;
  refresh?: string;
  expires?: number;
  [key: string]: unknown;
}

export type PiAuthData = Record<string, PiOAuthCredential | undefined>;

export interface OAuthAccessTokenResult {
  accessToken: string | null;
  source: "access" | "refreshed" | null;
  error?: string;
}

const TOKEN_EXPIRY_SKEW_MS = 60_000;

export const PI_AUTH_FILE = path.join(homedir(), ".pi", "agent", "auth.json");

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function readPiAuth(authFile = PI_AUTH_FILE): Promise<PiAuthData | null> {
  try {
    const raw = await readFile(authFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const obj = asObject(parsed);
    return obj as PiAuthData | null;
  } catch {
    return null;
  }
}

function isTokenFresh(credential: PiOAuthCredential | undefined, nowMs = Date.now()): boolean {
  if (!credential?.access) {
    return false;
  }

  if (typeof credential.expires !== "number") {
    return true;
  }

  return nowMs + TOKEN_EXPIRY_SKEW_MS < credential.expires;
}

async function refreshOAuthAccessToken(providerId: PiOAuthProviderId, authData: PiAuthData): Promise<string | null> {
  try {
    const mod = await import("@mariozechner/pi-ai");
    const resolver = (mod as { getOAuthApiKey?: unknown }).getOAuthApiKey;

    if (typeof resolver !== "function") {
      return null;
    }

    const result = await (
      resolver as (
        providerId: PiOAuthProviderId,
        credentials: Record<string, Record<string, unknown>>,
      ) => Promise<{ apiKey?: string } | null>
    )(providerId, authData as Record<string, Record<string, unknown>>);

    if (typeof result?.apiKey === "string" && result.apiKey.length > 0) {
      return result.apiKey;
    }

    return null;
  } catch {
    return null;
  }
}

export async function resolveOAuthAccessToken(providerId: PiOAuthProviderId): Promise<OAuthAccessTokenResult> {
  const auth = await readPiAuth();
  if (!auth) {
    return { accessToken: null, source: null };
  }

  const credential = auth[providerId];
  if (!credential) {
    return { accessToken: null, source: null };
  }

  if (isTokenFresh(credential)) {
    return { accessToken: credential.access ?? null, source: "access" };
  }

  if (credential.refresh) {
    const refreshed = await refreshOAuthAccessToken(providerId, auth);
    if (refreshed) {
      return { accessToken: refreshed, source: "refreshed" };
    }
  }

  if (credential.access) {
    return {
      accessToken: credential.access,
      source: "access",
      error: "access token may be expired",
    };
  }

  return {
    accessToken: null,
    source: null,
    error: "missing access token",
  };
}
