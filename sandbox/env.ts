/**
 * Loads sandbox/.env into process.env without overriding values already set.
 * Bun's built-in .env loader only reads from cwd; we want a sandbox-local
 * file regardless of where the script is invoked from.
 *
 * Format:    KEY=value      (one per line)
 *            KEY="value"    (quotes stripped)
 *            # comment
 *            <blank line>
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(SCRIPT_DIR, ".env");

export function loadSandboxEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export function requireEnv(key: string, hint?: string): string {
  const value = process.env[key];
  if (!value) {
    const suffix = hint ? `\n  ${hint}` : "";
    throw new Error(
      `Missing required env var ${key}.\n  Set it in sandbox/.env (see sandbox/.env.example) or export it before running.${suffix}`,
    );
  }
  return value;
}
