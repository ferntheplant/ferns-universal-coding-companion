import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function makeFileId(path: string): string {
  return sha256Hex(path).slice(0, 16);
}

export function makeFileFingerprint(path: string, patch: string): string {
  return sha256Hex(`${path}\n${patch}`);
}
