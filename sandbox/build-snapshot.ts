#!/usr/bin/env bun
/**
 * Build the Pi harness Daytona snapshot from sandbox/Dockerfile.
 *
 * Run:
 *   bun sandbox/build-snapshot.ts
 *
 * Pipeline:
 *   1. Tar the repo (excluding node_modules / .git / build artifacts) into
 *      sandbox/_context.tar.gz — Daytona uploads the Dockerfile's directory
 *      as build context, so the tarball has to live there.
 *   2. Call daytona.snapshot.create with Image.fromDockerfile. Daytona's
 *      builder runs the Dockerfile server-side; the final RUNs do bun
 *      install + ./install.sh so the snapshot is "ready to go".
 *   3. Clean up the tarball regardless of success/failure.
 *
 * The Daytona CLI ships pointed at the cloud API and has no flag to
 * redirect at a local instance, so we drive everything through the SDK.
 *
 * Args:
 *   bun sandbox/build-snapshot.ts [<version>]
 *   Optional positional <version> tags the snapshot — final name becomes
 *   `${base}-${version}`. Use this to keep multiple snapshots side-by-side
 *   (e.g. when iterating without losing the previous good build).
 *
 * Required env (load from sandbox/.env):
 *   DAYTONA_API_KEY         your local Daytona API key
 *
 * Optional env:
 *   DAYTONA_API_URL         default http://localhost:3000/api
 *   FUCC_SNAPSHOT_BASE      default "fucc-pi-harness"
 *   FUCC_SNAPSHOT_VERSION   alternative to positional arg
 *   FUCC_SNAPSHOT_NAME      bypass base/version entirely with an explicit name
 *   FUCC_FORCE_REBUILD      if set, delete an existing snapshot of the same
 *                           name first so the Dockerfile is re-built
 */

import { Daytona, Image } from "@daytona/sdk";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSandboxEnv, requireEnv } from "./env.ts";

loadSandboxEnv();

const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DOCKERFILE_PATH = resolve(SCRIPT_DIR, "Dockerfile");
const CONTEXT_TARBALL = resolve(SCRIPT_DIR, "_context.tar.gz");
const DEFAULT_SNAPSHOT_BASE = "fucc-pi-harness";

function log(msg: string): void {
  console.log(`[fucc-snapshot] ${msg}`);
}

function resolveSnapshotName(): string {
  if (process.env.FUCC_SNAPSHOT_NAME) return process.env.FUCC_SNAPSHOT_NAME;
  const base = process.env.FUCC_SNAPSHOT_BASE ?? DEFAULT_SNAPSHOT_BASE;
  const version = process.argv[2] ?? process.env.FUCC_SNAPSHOT_VERSION;
  return version ? `${base}-${version}` : base;
}

function tarRepo(): void {
  log(`tarring repo -> ${CONTEXT_TARBALL}`);
  const result = spawnSync(
    "tar",
    [
      "--exclude=./node_modules",
      "--exclude=./.git",
      "--exclude=./.turbo",
      "--exclude=./dist",
      "--exclude=./sandbox/_context.tar.gz",
      "-czf",
      CONTEXT_TARBALL,
      "-C",
      REPO_ROOT,
      ".",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`tar failed with exit code ${result.status}`);
  }
}

async function main() {
  const apiUrl = process.env.DAYTONA_API_URL ?? "http://localhost:3000/api";
  const apiKey = requireEnv("DAYTONA_API_KEY");
  const name = resolveSnapshotName();

  log(`connecting to daytona at ${apiUrl}`);
  const daytona = new Daytona({ apiUrl, apiKey });

  if (process.env.FUCC_FORCE_REBUILD) {
    try {
      const existing = await daytona.snapshot.get(name);
      log(`FUCC_FORCE_REBUILD set — deleting existing snapshot "${name}"`);
      await daytona.snapshot.delete(existing);
    } catch {
      // didn't exist; nothing to delete
    }
  } else {
    try {
      const existing = await daytona.snapshot.get(name);
      log(
        `snapshot "${name}" already exists (state=${existing.state}). Set FUCC_FORCE_REBUILD=1 to recreate.`,
      );
      return;
    } catch {
      // not found — fall through to build
    }
  }

  tarRepo();
  try {
    log(`building snapshot "${name}" from ${DOCKERFILE_PATH}`);
    const image = Image.fromDockerfile(DOCKERFILE_PATH);
    try {
      await daytona.snapshot.create(
        {
          name,
          image,
          resources: { cpu: 2, memory: 4, disk: 8 },
        },
        {
          timeout: 0,
          onLogs: (chunk) => process.stdout.write(chunk),
        },
      );
    } catch (err) {
      // The pre-flight `get()` can miss snapshots in some states (e.g. mid-build
      // or stuck), and the create call then surfaces a conflict. Translate to
      // an actionable message rather than the raw SDK dump.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || (err as { name?: string }).name === "DaytonaConflictError") {
        throw new Error(
          `Snapshot "${name}" already exists. Options:\n` +
            `  - Bump the version: bun sandbox/build-snapshot.ts <new-version>\n` +
            `  - Force rebuild:    FUCC_FORCE_REBUILD=1 bun sandbox/build-snapshot.ts ${process.argv[2] ?? ""}\n`,
        );
      }
      throw err;
    }

    const finished = await daytona.snapshot.get(name);
    log(
      `snapshot ready: name=${finished.name} state=${finished.state} size=${finished.size}`,
    );
  } finally {
    if (existsSync(CONTEXT_TARBALL)) {
      rmSync(CONTEXT_TARBALL, { force: true });
    }
  }
}

main().catch((err) => {
  console.error("[fucc-snapshot] failed:", err);
  if (existsSync(CONTEXT_TARBALL)) rmSync(CONTEXT_TARBALL, { force: true });
  process.exit(1);
});
