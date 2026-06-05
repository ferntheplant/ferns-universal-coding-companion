#!/usr/bin/env bun
/**
 * Prepare a Daytona sandbox to host work on the tycho app.
 *
 * Run before `bunx flue connect app-worker local` — Flue's local-mode
 * connection has a ~5s readiness timeout, which the full provision flow
 * (clone + mise install + pnpm install + dev servers) blows past. This
 * script does the slow work once; the Flue agent then looks up the
 * already-prepared sandbox by label and connects in milliseconds.
 *
 * If a healthy sandbox for tycho already exists, this is a no-op (~500ms
 * to list + return).
 *
 * Run:
 *   bun sandbox/provision-tycho.ts
 *
 * Requires: DAYTONA_API_KEY in sandbox/.env or repo-root .env.
 */

import { tychoConfig } from "../config/tycho.ts";
import { findOrProvisionAppSandbox } from "./provision.ts";

const { sandbox, repoDir, logDir } = await findOrProvisionAppSandbox(tychoConfig);

console.log("=".repeat(60));
console.log(`Sandbox ID:   ${sandbox.id}`);
console.log(`State:        ${sandbox.state}`);
console.log(`Repo dir:     ${repoDir}`);
console.log(`Log dir:      ${logDir}`);
console.log("=".repeat(60));
console.log("Now run:  bunx flue connect app-worker local");
