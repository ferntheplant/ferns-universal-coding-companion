# `orchestrator/` — drive a coding agent inside a Daytona sandbox

Lightweight glue between [`sandbox/`](../sandbox/) (which provisions Daytona
sandboxes and bakes Pi + extensions into a snapshot) and whichever coding-agent
CLI you want to run inside one. Replaces an earlier Flue-based agent module
that turned out to be the wrong fit — Flue uses `pi-ai` as a library but does
not carry over the Pi CLI's extensions, settings, skills, or themes. If you
want your existing Pi harness to actually be used, the orchestrator runs the
Pi CLI inside the sandbox where the harness is baked in.

The orchestrator is intentionally small. The hard parts (snapshot + clone +
mise install + dev servers) live in `sandbox/provision.ts`. The "agent
runtime" is just: look up a prepared sandbox by label, run an agent CLI
inside it, stream output back, exit.

## Layout

```
orchestrator/
├── run-agent.ts        # runAgent(sandbox, { agent, prompt, sessionId, cwd, model })
├── work-on-tycho.ts    # CLI for the tycho app — provision + run + stream
├── tsconfig.json
└── README.md           # you are here

config/
└── tycho.ts            # tycho's AppSandboxConfig (repo, env files, init, dev servers)

sandbox/
└── ...                 # provisioner + Dockerfile + snapshot tooling
```

## Quickstart

```bash
# First time only — provisions a sandbox if there isn't one for this repo.
# Cold start does clone + mise install + pnpm install + dev-server boot.
# Re-running this when a sandbox already exists is ~500ms.
bun sandbox/provision-tycho.ts

# Send a prompt. Ctrl-C disconnects; the sandbox + agent session keep
# running. Re-run the same command to resume the same conversation.
bun orchestrator/work-on-tycho.ts "explain how the staking flow works"

# Status (no positional argument).
bun orchestrator/work-on-tycho.ts

# Flags:
#   --agent <name>     pi (default) | claude-code | codex | opencode (stubs)
#   --model <spec>     model specifier (default: opencode-go/qwen3.6-plus)
#   --session <id>     conversation id; default "tycho-<agent>"
#   --fresh            use a timestamp-suffixed session (ignore prior state)
bun orchestrator/work-on-tycho.ts --fresh --model opencode-go/qwen3.6-plus "..."
```

For a new app, copy `config/tycho.ts` and `orchestrator/work-on-tycho.ts`,
swap repo / env paths / init / dev servers. Everything else is generic.

## How it works

### Provisioning lifecycle (slow path)

`sandbox/provision.ts` exports two relevant entry points:

- `provisionAppSandbox(cfg)` — always creates a new sandbox from the
  `fucc-pi-harness` snapshot, then clones the repo, uploads `.env.local` files
  + Pi auth, runs `mise install` + `mise run init`, and starts the dev
  servers detached via `nohup`. Returns a `ProvisionedSandbox`. Slow (~30s on
  a warm path, minutes the first time).
- `findOrProvisionAppSandbox(cfg)` — looks up an existing sandbox by label
  (`purpose=flue-app-worker, repo=<owner/repo>`). If one is in `state="started"`,
  return it. Otherwise call `provisionAppSandbox`. This is what
  `provision-tycho.ts` and `work-on-tycho.ts` both call.

Sandboxes auto-stop after 60min of idle (Daytona's `autoStopInterval=60`),
but `autoDeleteInterval=-1` so the disk persists. Pi sessions on disk
(under `/root/.pi/agent/sessions/<id>/`) survive across stop/start, so
reconnecting later resumes the same conversation. **Dev servers do not
survive stop/start** — they were `nohup` processes that died with the
sandbox. If you find a stopped sandbox and want it back, the current
`findOrProvisionAppSandbox` provisions a fresh one alongside rather than
waking the old one (deliberately — dev servers being dead is more honest
than reusing a half-state sandbox). If that gets noisy, add a `--recreate`
flag.

### Agent execution flow (fast path)

`runAgent(sandbox, opts)` in `run-agent.ts`:

1. Ensure a long-lived Daytona session named `orchestrator` exists in the
   sandbox. This is Daytona's "session" — a persistent shell, not the Pi
   conversation session. Idempotent.
2. Build the agent-specific CLI invocation. For Pi today:
   ```
   script -q -c 'pi --session-id <sid> --model <m> -p <prompt>' /dev/null
   ```
   The `script -q -c ... /dev/null` wrap allocates a pseudo-TTY around Pi
   so its stdout is line-buffered, not block-buffered (see "Gotchas" below).
3. `executeSessionCommand(..., runAsync: true)` to submit, get a `cmdId`.
4. `getSessionCommandLogs(sessionId, cmdId, onStdout, onStderr)` streams
   logs to the local terminal until the command exits.
5. `getSessionCommand(sessionId, cmdId)` to read the exit code.

Pi's `--session-id` provides the conversation continuity. Same value
across runs = same Pi conversation, automatically. `work-on-tycho.ts`
defaults to `tycho-<agent>` so e.g. `tycho-pi` is your default Pi
conversation, `tycho-claude` would be a separate one (when claude-code is
wired up).

## Gotchas

Things we learned the hard way. Read these before you spend an hour
debugging the same thing.

### Pi's stdout block-buffers without a TTY

`executeSessionCommand` runs the command with stdout/stderr as pipes, not
TTYs. libuv's default for pipe-mode stdout is **block-buffered** (typically
4KB+). For a long Pi run (many model + tool-call rounds, each producing
some progress text), the buffer never fills, so we'd see nothing until Pi
exited — looking like an indefinite hang.

Fix: wrap Pi in `script -q -c <cmd> /dev/null`. That allocates a pty, Pi
detects a TTY, libuv switches to line-buffering, output flows out as it's
produced. Why the wrap is needed only in the orchestrator path: `daytona
sandbox exec` allocates a pty for you; `executeSessionCommand` does not.

The Langfuse startup line comes through even without `script` because
that's emitted on stderr, which libuv leaves unbuffered by default.
That's how we got fooled into thinking Pi was past startup but stuck.

### Daytona's env-var passthrough is unreliable

`Dockerfile` `ENV PATH=...` does not reliably reach the env that
`executeSessionCommand` runs commands under. We saw mise on `PATH` at
build time but not at runtime. Set anything you need in the `envVars`
argument to `daytona.create(...)` instead — that *does* propagate
reliably. The provisioner already sets `PATH`, `HOME`, `GH_TOKEN`, and
the LLM provider keys via `envVars` for this reason.

### `bash -lc` resets `PATH`

We hit this when wrapping mise-managed commands. A login shell
(`bash -l`) sources `/etc/profile` + `/root/.profile`, which on Debian
**overwrite** `PATH` to a system default that excludes `/root/.local/bin`.
So even with `PATH` set correctly in `envVars`, `bash -lc 'mise run …'`
runs with a stripped `PATH` and `mise` is "not found".

Fix: `bash -c`, not `bash -lc`. The provisioner's `withMise` helper
uses `bash -c`.

### `gh` panics in the sandbox under emulation

When the sandbox was amd64-under-qemu, `gh repo clone` triggered a Go
runtime panic (`runtime: marked free object in span ... fatal error:
found pointer to free object`). This is a known class of bug — Go's
runtime is fragile under qemu userspace emulation.

Fix #1 (general): pin the snapshot to `linux/arm64` in the Dockerfile so
nothing runs under qemu. Done in `sandbox/Dockerfile`.

Fix #2 (defense in depth): the clone path uses plain `git clone
https://x-access-token:$GH_TOKEN@github.com/<repo>.git` rather than
`gh repo clone`. Doesn't depend on `gh`'s runtime at all; works even if
`gh` is broken for any reason. `GH_TOKEN` is forwarded into the sandbox
via `envVars`, picked up by `gh`'s normal env-var lookup (so any other
sandbox-internal tooling that wants `gh` still works).

We also deliberately do **not** upload `~/.config/gh/hosts.yml`. On a
fresh slim Debian, `gh` tries to migrate older multi-account configs via
the system keyring → shells out to `dbus-launch` → fails because dbus
isn't installed → "couldn't find oauth token for github.com".
`GH_TOKEN` bypasses hosts.yml + keyring entirely.

### mise refuses untrusted configs by default

`mise install` errors out with "Config files in /workspace/tycho/mise.toml
are not trusted" until you `mise trust` them. The provisioner runs
`mise trust --all` in the repo dir before `mise install` for this reason.

### `mise.toml` task scripts can require zsh

Tycho's `[tasks.init]` script has `#!/usr/bin/env zsh`. Debian-slim doesn't
ship zsh. We add `zsh` to the apt install in the Dockerfile. If you adapt
this orchestrator for a different app whose init script uses a different
shebang (fish? nu? something else), add it to the apt list too.

### Apple Silicon + Daytona snapshots default to amd64

Daytona's image builder appears to default to `linux/amd64` even when the
host is arm64. You get an x86_64 snapshot running under qemu-x86_64 on an
arm64 Mac — which mostly works but is unusably slow (Node → wall-clock
inflated 5–10×) and triggers the Go panic above.

Fix: `FROM --platform=linux/arm64 debian:bookworm-slim` in the Dockerfile.
Verify with `daytona sandbox exec <id> -- uname -m` (should be `aarch64`).
Change the platform if you actually want amd64.

### Chrome for Testing has no `linux/arm64` build

`agent-browser install` (which downloads Chrome for Testing) fails on arm64
with "Chrome for Testing does not provide Linux ARM64 builds." Workaround
baked into the Dockerfile:

- Install Debian's `chromium` package (native arm64).
- Skip `agent-browser install`.
- Set `PUPPETEER_EXECUTABLE_PATH`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`,
  `AGENT_BROWSER_EXECUTABLE_PATH`, `CHROME_PATH` to `/usr/bin/chromium` via
  Dockerfile `ENV`. If any of those don't propagate to runtime (see the
  general Daytona env gotcha), move them to `envVars` in `provision.ts`.

### `pi-langfuse` blocks on first run unless config is mounted

Without a config file, `pi-langfuse` opens a first-run prompt asking for
keys. In `-p` (print) mode that prompt never resolves and Pi hangs.

Fix: the provisioner uploads `~/.pi/agent/pi-langfuse/config.json` from
the host into the sandbox at `/root/.pi/agent/pi-langfuse/config.json`.
Other Pi extensions that store config in `~/.pi/agent/<name>/` can be
added to `PI_STATE_FILES` in `sandbox/provision.ts` — the upload loop
handles arbitrary sub-paths.

### Sandbox can't resolve tailnet hostnames

If your Langfuse host is `*.ts.net`, the sandbox can't reach it
(tailscaled lives on the host, two network namespaces away). The
provisioner detects `.ts.net` hosts in the uploaded
`pi-langfuse/config.json` and rewrites them to
`http://host.docker.internal:<port>`. **You need to run a caddy proxy on
the host** that bridges that port to the tailnet origin:

```bash
caddy reverse-proxy --from :3004 --to https://<your-tailnet-host>:3004
```

The README in `sandbox/` covers the equivalent for other tailnet services.
Without caddy running, Pi appears to start (the Langfuse line prints) but
the first trace flush blocks.

### Pi sessions persist on the sandbox disk

Pi stores sessions under `/root/.pi/agent/sessions/<session-id>/`. The
sandbox disk persists across `autoStop`, so resuming with the same
`--session-id` picks up the conversation history. If a session gets into
a weird state (e.g., from a Ctrl-C'd run mid-tool-call), passing
`--fresh` to `work-on-tycho.ts` uses a timestamp-suffixed session id so
you're not loading the bad history.

## Adding another agent

`buildAgentCommand` in `run-agent.ts` has stub cases for `claude-code`,
`codex`, `opencode` that throw. Wire each one by running the relevant CLI
inside the sandbox and reading `--help` for the right combination of:

- Non-interactive / print-mode flag.
- Resume-by-id flag.
- Model selector flag.

Wrap the resulting command in `script -q -c <cmd> /dev/null` the same way
Pi is wrapped — TTY allocation matters for any agent CLI that uses libuv
or otherwise block-buffers stdout.

## Adding another app

Three pieces, all small:

1. `config/<app>.ts` — an `AppSandboxConfig` like `config/tycho.ts`.
2. `sandbox/provision-<app>.ts` — three-line CLI like
   `sandbox/provision-tycho.ts`.
3. `orchestrator/work-on-<app>.ts` — copy of `work-on-tycho.ts` with the
   `APP` constant + config import swapped.

The sandbox labels (`purpose=flue-app-worker, repo=<owner/repo>`) namespace
sandboxes by repo, so multiple apps coexist without colliding.

## Loose ends

Things we noticed but didn't fix.

- **Daytona-agent itself runs under qemu.** Inside an arm64 sandbox, the
  `daytona-agent` binary at PID 1 is `/usr/bin/qemu-x86_64
  /usr/local/bin/daytona ...`. Daytona ships an amd64 agent and the snapshot
  runs it under emulation. Doesn't affect Pi (which is native), but adds
  per-command overhead to anything routed through Daytona's RPC. Worth
  raising upstream when you find the time.
- **`pi-langfuse` shutdown race.** Every Pi run ends with
  `📊 Langfuse: Deferred shutdown failed TypeError: Cannot read properties
  of null (reading 'clearTracerProvider')`. Benign — the OTLP exporter loses
  the race with Pi's process exit — but noisy. Fix would be in the
  extension code (`extensions/pi-langfuse/src/langfuse.ts:378`).
- **Dev servers untested through the agent.** The provisioner starts
  `spacetime-host` (`pnpm run host`) and `tycho-dev` (`pnpm run dev`)
  detached via `nohup`, logs at `/var/log/app/<name>.log`. We confirmed
  the PID file is written, but no end-to-end test through Pi yet — e.g.
  prompting Pi to `curl localhost:5174` to confirm the Vite frontend is
  actually serving. Worth running once to validate.
- **Stale sandboxes aren't cleaned up automatically.** If a provision step
  fails partway through, the sandbox is left in a non-`started` state and
  `findOrProvisionAppSandbox` provisions alongside rather than reusing.
  You'll accumulate dead sandboxes over time. `daytona sandbox list
  --label repo=withcompany/tycho` + `daytona sandbox delete <id>` cleans
  them up by hand for now.
- **`claude-code` / `codex` / `opencode` are stubs.** As above —
  one-off-able once you confirm the exact CLI shape inside the snapshot.

## Related

- [`sandbox/README.md`](../sandbox/README.md) — snapshot build / per-sandbox
  setup, including the caddy-proxy details for tailnet services.
- [`config/tycho.ts`](../config/tycho.ts) — the app config shape.
- [`sandbox/provision.ts`](../sandbox/provision.ts) — the provisioner and
  the `PI_STATE_FILES` list of host configs to mirror into the sandbox.
