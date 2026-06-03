# `sandbox/` — Daytona sandbox harness

Self-contained tooling for spinning up isolated [Daytona](https://daytona.io) sandboxes preloaded with this Pi agent harness — your `pi` binary, all the extension dependencies, your repo, and your auth, ready to use in seconds.

The slow setup (image build) happens once. The fast loop (boot a sandbox, smoke test, throw it away) takes ~15 seconds.

## Layout

```
sandbox/
├── Dockerfile         # Image definition — env + repo + bun install + ./install.sh
├── build-snapshot.ts  # Tars the repo, calls daytona.snapshot.create
├── run-sandbox.ts     # Creates a sandbox from the snapshot, injects auth, smoke-tests
├── env.ts             # Loads sandbox/.env, defines requireEnv()
├── .env.example       # Template — copy to .env and fill in
└── tsconfig.json      # Extends ../tsconfig.base.json
```

## Workflow

### One-time setup

1. **Local Daytona instance.** This setup assumes you've already got Daytona running on `localhost:3000`. See [Daytona's self-hosting docs](https://www.daytona.io/docs/en/self-hosting/) for the docker-compose path.

2. **Add the `minio` /etc/hosts entry.** When Daytona's snapshot builder hands clients a presigned upload URL for build context, it returns its internal docker hostname (`minio:9000`). From your host, that hostname doesn't resolve. Workaround:

   ```bash
   echo "127.0.0.1 minio" | sudo tee -a /etc/hosts
   ```

   Daytona-internal services still resolve `minio` via docker DNS, so this only affects what your laptop sees.

3. **Create `sandbox/.env`.**

   ```bash
   cp sandbox/.env.example sandbox/.env
   $EDITOR sandbox/.env
   ```

   Required: `DAYTONA_API_KEY`. Generate one from your Daytona dashboard.

### Build the snapshot

```bash
bun sandbox/build-snapshot.ts
```

Cold build is ~6 minutes (most of it is the `agent-browser install` step downloading Chromium). Subsequent rebuilds reuse cached layers — see **Cache invalidation** below.

To keep multiple versions side by side:

```bash
bun sandbox/build-snapshot.ts v2     # builds "fucc-pi-harness-v2"
```

To force a rebuild over an existing snapshot:

```bash
FUCC_FORCE_REBUILD=1 bun sandbox/build-snapshot.ts
```

### Spin up a sandbox

```bash
bun sandbox/run-sandbox.ts           # uses the default snapshot
bun sandbox/run-sandbox.ts v2        # uses the tagged snapshot
```

Sandbox creation is near-instant because everything is baked into the snapshot. The script:

1. Looks up the snapshot (fails fast with a build hint if missing).
2. Creates the sandbox with LLM env vars forwarded from your host.
3. Uploads your `~/.pi/agent/auth.json` (and `models.json` if present) so the sandbox inherits your OAuth subscriptions + custom providers.
4. Runs a smoke test (`pi --version`, tool versions, `pi list`, etc.).
5. Leaves the sandbox running (`autoDeleteInterval = -1`).

Stop it manually via `daytona stop <id>` or set `FUCC_KEEP_SANDBOX=1` if you want to be explicit about leaving it.

## Architecture

### Why a snapshot, not a per-run build

The Dockerfile bakes in everything that's slow (Chromium download, apt packages, `pi install`'d manifest packages, the harness `bun install`). The resulting Daytona snapshot is reused for every sandbox creation. Tradeoff: any harness edit requires a snapshot rebuild — but most of the Dockerfile stays cached.

### Layered Dockerfile

Layers are ordered by churn rate, least to most:

1. apt base tooling + Chromium runtime libs
2. Node 22 (nodesource)
3. Bun
4. npm-global CLIs (`pi`, `agent-browser`, `@ast-grep/cli`) + `agent-browser install` (Chrome download)
5. difftastic from GitHub release
6. `COPY _context.tar.gz` (this and below invalidate on **any** repo file change)
7. `bun install --frozen-lockfile`
8. `./install.sh` — wires `~/.pi/agent/` symlinks + `pi install` of manifest packages
9. `pi update`

Editing extension code re-runs layers 6–9 only. Editing the Dockerfile higher up cascades down.

### Why a tarball, not `COPY .`

Daytona's snapshot builder uses the Dockerfile's directory as build context. `COPY . /opt/fucc` would pull `node_modules`, the local `.git`, and the rest into the build context — slow and noisy. Instead, `build-snapshot.ts`:

1. Tars the repo (excluding `node_modules`, `.git`, `.turbo`, `dist`) into `sandbox/_context.tar.gz`.
2. Calls `daytona.snapshot.create({ image: Image.fromDockerfile(...) })` which uploads only that single file as context.
3. Cleans up the tarball whether the build succeeds or fails.

`sandbox/_context.tar.gz` is gitignored. If you ever see a stale one in the tree, something interrupted a build — safe to delete.

### Auth injection

The Pi harness reads OAuth refresh tokens and API keys from `~/.pi/agent/auth.json`. Rather than running OAuth flows inside the sandbox (which would mean re-logging-in every time), `run-sandbox.ts` uploads your local `auth.json` + `models.json` (if present) to `/root/.pi/agent/` with `0600` perms after the sandbox starts. Pi inside the sandbox then has the same subscriptions and providers as you do on your laptop.

This is a credential **mount**, not a proxy — the auth.json file enters the sandbox filesystem. Acceptable for a personal dev sandbox; **not** appropriate if you hand the sandbox to anyone else. Opt out with `FUCC_SKIP_PI_AUTH=1`.

The same script also forwards any of these env vars that are set on your host:

```
ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, OPENAI_API_KEY, OPENAI_BASE_URL,
GEMINI_API_KEY, GOOGLE_API_KEY, SYNTHETIC_API_KEY, ZEN_API_KEY,
OPENCODE_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY,
XAI_API_KEY
```

Belt-and-suspenders. If a provider's auth lives in both `auth.json` and an env var, Pi resolves from whichever it prefers.

## Reaching tailnet services

By default the sandbox can reach your laptop at `host.docker.internal` (effectively `192.168.5.2`), but **not** tailscale hostnames. Tailscale lives on your macOS host, two network namespaces away from the sandbox.

If you want the sandbox to talk to a tailnet service (e.g., self-hosted Langfuse on your home server), run an HTTP-aware proxy on the laptop:

```bash
brew install caddy
caddy reverse-proxy --from :3004 --to https://homeserver:3004
```

Then in `sandbox/.env`:

```bash
LANGFUSE_HOST=http://host.docker.internal:3004
```

Caddy listens for plain HTTP from the sandbox and does HTTPS upstream with the correct SNI and cert validation — so the sandbox URL is `http://...` even though your home server speaks HTTPS. Don't put `https://` on the sandbox-side URL; caddy is the HTTPS terminator, not the sandbox.

For plain-HTTP tailnet services, `socat` works in place of caddy:

```bash
socat TCP-LISTEN:PORT,fork,reuseaddr TCP:tailnet-host:PORT
```

If you find yourself needing many tailnet services or wanting the sandbox to be a tailnet citizen, the right next step is running `tailscaled` inside the sandbox itself — not yet implemented.

## Cache invalidation

| What you change | What re-runs |
|---|---|
| Any file in the harness repo | Layers 6–9: COPY, bun install, `./install.sh`, `pi update` (~1–3 min) |
| `manifest.json` (new pi packages) | Same as above. `pi install` re-runs at layer 8 |
| The Dockerfile's apt/node/bun/npm RUN text | That layer + everything below it. Worst case ~6 min |
| `ARG DIFFT_VERSION` bump | difftastic layer + COPY + below (~1 min) |
| Nothing | Snapshot reuses cached snapshot — `build-snapshot.ts` bails out early with a hint to use `FUCC_FORCE_REBUILD=1` |

Upstream version bumps to `pi-coding-agent`, `agent-browser`, etc. **don't** trigger rebuilds — the RUN text is byte-identical even though `npm install -g @latest` would otherwise pull newer code. To pick up new versions, edit the RUN to pin a version, or use `FUCC_FORCE_REBUILD=1`.

## Configuration reference

### `sandbox/.env`

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DAYTONA_API_KEY` | yes | — | Local Daytona auth key |
| `DAYTONA_API_URL` | no | `http://localhost:3000/api` | Daytona API endpoint |
| `FUCC_SNAPSHOT_BASE` | no | `fucc-pi-harness` | Snapshot name prefix |
| `FUCC_SNAPSHOT_VERSION` | no | — | Suffix to snapshot name (alternative to positional arg) |
| `FUCC_SNAPSHOT_NAME` | no | computed | Explicit override of the computed name |
| `FUCC_FORCE_REBUILD` | no | unset | Delete existing snapshot before building |
| `FUCC_KEEP_SANDBOX` | no | unset | Cosmetic note; sandbox already has `autoDeleteInterval=-1` |
| `FUCC_SKIP_PI_AUTH` | no | unset | Don't upload `~/.pi/agent/{auth,models}.json` |
| `LANGFUSE_*` | no | — | Langfuse client config, forwarded into sandbox |
| LLM provider keys | no | host env | Forwarded into sandbox (see list above) |

### Positional args

Both scripts accept a positional `<version>` as `process.argv[2]`. Equivalent to setting `FUCC_SNAPSHOT_VERSION`:

```bash
bun sandbox/build-snapshot.ts v2
bun sandbox/run-sandbox.ts v2
```

## Known gotchas

These are the rakes I stepped on while building this; documenting them so you don't.

### `minio:9000` hostname not resolving from the host
Add `127.0.0.1 minio` to `/etc/hosts`. See **One-time setup**.

### `DaytonaConflictError: Snapshot ... already exists`
The pre-flight `snapshot.get(name)` check misses snapshots in some states (mid-build, errored, etc.), and the create call then surfaces a conflict. Either:
- Bump the version: `bun sandbox/build-snapshot.ts <new-version>`
- Force rebuild: `FUCC_FORCE_REBUILD=1 bun sandbox/build-snapshot.ts`

### TLS "wrong version number" when pointing at a tailnet service
You set `LANGFUSE_HOST=https://...` but caddy is listening on plain HTTP. The sandbox starts a TLS handshake against an HTTP listener → caddy responds in plain HTTP → SDK can't parse non-TLS bytes. Fix: use `http://` on the sandbox side. Caddy is the HTTPS terminator.

### Daytona SDK `runCommands` is fragile with multi-line scripts
`Image.runCommands(["bash", "-lc", multilineScript])` wraps args in `"..."` but doesn't escape newlines, so the resulting Dockerfile RUN becomes multi-line and the Dockerfile parser fails with `unknown instruction: apt-get`. Worked around in `Dockerfile` by writing raw `RUN` lines (no `runCommands` involvement).

Bonus: even single-line scripts get wrapped in `/bin/sh -c "..."` by Docker (shell form), which expands `$VAR` references from sh's own env *before* bash sees them. Same workaround.

### Tarball non-determinism
`tar` output on macOS is mostly deterministic but timestamps can drift. If you run `build-snapshot.ts` twice with no code changes and BuildKit re-runs the COPY layer, that's why. Fix would be `--sort=name --mtime=@0` for byte-identical tars. Not worth doing preemptively.

## Future work

Things that would be nice but aren't priorities yet:

- Run `tailscaled` inside the sandbox so it joins the tailnet as its own ephemeral node — would replace the caddy reverse-proxy dance and make any tailnet hostname directly reachable.
- Split `pi install <pkg>` into its own Dockerfile layer above the `COPY`, so editing extension source doesn't re-run npm installs of the manifest packages.
- `FUCC_PI_AUTH_FILE=path/to/scoped/auth.json` to inject a curated auth file instead of `~/.pi/agent/auth.json` — useful when you want a sandbox to have access to only a subset of providers.
