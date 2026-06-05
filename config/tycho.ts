/**
 * Shared config for the tycho app sandbox. Imported by:
 *   - sandbox/provision-tycho.ts (the CLI that prepares the sandbox)
 *   - agents/app-worker.ts       (the Flue agent that connects to it)
 *
 * Lives outside agents/ because Flue scans that directory and expects
 * every file there to default-export createAgent(...).
 *
 * Edit TYCHO_LOCAL_CHECKOUT or the config block to point at a different
 * checkout / branch / set of env files.
 */

import type { AppSandboxConfig } from "../sandbox/provision.ts";

const TYCHO_LOCAL_CHECKOUT =
  process.env.TYCHO_LOCAL_CHECKOUT ?? `${process.env.HOME}/withco/tycho`;

export const tychoConfig: AppSandboxConfig = {
  repo: "withcompany/tycho",
  cloneDir: "/workspace/tycho",
  envFiles: [
    {
      hostPath: `${TYCHO_LOCAL_CHECKOUT}/apps/spacetimedb/.env.local`,
      sandboxPath: "apps/spacetimedb/.env.local",
    },
    {
      hostPath: `${TYCHO_LOCAL_CHECKOUT}/apps/web/.env.local`,
      sandboxPath: "apps/web/.env.local",
    },
  ],
  // `mise run init` installs spacetime CLI, briefly runs a standalone server
  // for `spacetime login`, then runs `pnpm install`.
  initCommand: "mise run init",
  devServers: [
    {
      name: "spacetime-host",
      command: "pnpm run host",
    },
    {
      name: "tycho-dev",
      command: "pnpm run dev",
    },
  ],
};
