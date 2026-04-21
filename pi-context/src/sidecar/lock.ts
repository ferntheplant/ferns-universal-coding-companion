import { readFile, rm, writeFile } from "node:fs/promises";
import { getSidecarPaths } from "./paths";

export interface SidecarLockRecord {
  pid: number;
  port: number;
  url: string;
  startedAt: string;
}

export async function readSidecarLock(): Promise<SidecarLockRecord | null> {
  try {
    const raw = await readFile(getSidecarPaths().lockFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<SidecarLockRecord>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.port !== "number" ||
      typeof parsed.url !== "string" ||
      typeof parsed.startedAt !== "string"
    ) {
      return null;
    }

    return {
      pid: parsed.pid,
      port: parsed.port,
      url: parsed.url,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export async function writeSidecarLock(record: SidecarLockRecord): Promise<void> {
  await writeFile(getSidecarPaths().lockFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function clearSidecarLock(): Promise<void> {
  await rm(getSidecarPaths().lockFile, { force: true });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
