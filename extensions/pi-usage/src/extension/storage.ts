import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface ZenAuthRecord {
  dashboardUrl: string;
  cookies: Record<string, string>;
  updatedAt: number;
}

interface ExtensionStorageData {
  zenAuth?: ZenAuthRecord;
}

export const EXTENSION_STORAGE_FILE = path.join(
  homedir(),
  ".pi",
  "agent",
  "state",
  "pi-usage",
  "storage.json",
);

const LEGACY_EXTENSION_STORAGE_FILE = path.join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-usage",
  "storage.json",
);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseZenAuth(value: unknown): ZenAuthRecord | null {
  const obj = asRecord(value);
  if (!obj) {
    return null;
  }

  const dashboardUrl = typeof obj.dashboardUrl === "string" ? obj.dashboardUrl : null;
  const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : null;
  const cookiesRaw = asRecord(obj.cookies);

  if (!dashboardUrl || !updatedAt || !cookiesRaw) {
    return null;
  }

  const cookies: Record<string, string> = {};
  for (const [name, cookieValue] of Object.entries(cookiesRaw)) {
    if (typeof cookieValue === "string" && cookieValue.length > 0) {
      cookies[name] = cookieValue;
    }
  }

  if (Object.keys(cookies).length === 0) {
    return null;
  }

  return {
    dashboardUrl,
    updatedAt,
    cookies,
  };
}

export async function readExtensionStorage(
  storageFile = EXTENSION_STORAGE_FILE,
): Promise<ExtensionStorageData> {
  try {
    const raw = await readFile(storageFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const obj = asRecord(parsed);
    if (!obj) {
      return {};
    }

    const zenAuth = parseZenAuth(obj.zenAuth);
    return {
      zenAuth: zenAuth ?? undefined,
    };
  } catch {
    return {};
  }
}

export async function writeExtensionStorage(
  data: ExtensionStorageData,
  storageFile = EXTENSION_STORAGE_FILE,
): Promise<void> {
  await mkdir(path.dirname(storageFile), { recursive: true });
  await writeFile(storageFile, JSON.stringify(data, null, 2), "utf-8");
}

export async function getZenAuthRecord(
  storageFile = EXTENSION_STORAGE_FILE,
): Promise<ZenAuthRecord | null> {
  const storage = await readExtensionStorage(storageFile);
  if (storage.zenAuth) {
    return storage.zenAuth;
  }

  if (storageFile !== EXTENSION_STORAGE_FILE) {
    return null;
  }

  const legacy = await readExtensionStorage(LEGACY_EXTENSION_STORAGE_FILE);
  if (!legacy.zenAuth) {
    return null;
  }

  await setZenAuthRecord(legacy.zenAuth, EXTENSION_STORAGE_FILE);
  return legacy.zenAuth;
}

export async function setZenAuthRecord(
  record: ZenAuthRecord,
  storageFile = EXTENSION_STORAGE_FILE,
): Promise<void> {
  const storage = await readExtensionStorage(storageFile);
  await writeExtensionStorage(
    {
      ...storage,
      zenAuth: record,
    },
    storageFile,
  );
}

export async function clearZenAuthRecord(storageFile = EXTENSION_STORAGE_FILE): Promise<void> {
  const storage = await readExtensionStorage(storageFile);
  const next: ExtensionStorageData = { ...storage };
  delete next.zenAuth;
  await writeExtensionStorage(next, storageFile);

  if (storageFile === EXTENSION_STORAGE_FILE) {
    const legacy = await readExtensionStorage(LEGACY_EXTENSION_STORAGE_FILE);
    if (legacy.zenAuth) {
      const legacyNext: ExtensionStorageData = { ...legacy };
      delete legacyNext.zenAuth;
      await writeExtensionStorage(legacyNext, LEGACY_EXTENSION_STORAGE_FILE);
    }
  }
}
