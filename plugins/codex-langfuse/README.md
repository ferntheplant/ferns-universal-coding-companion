# codex-langfuse

Codex plugin that sends hook-based agent traces to Langfuse. Each Codex turn is
recorded as a Langfuse trace with the [shared trace schema](../../README.md#observability)
so it can be compared against Pi, OpenCode, and Claude Code runs in one Langfuse project.

## Trace shape

```
codex:turn           (one per UserPromptSubmit → Stop)
  └─ codex:generation  (one per stop, with prompt + assistant output)
  └─ codex-tool-result  (event per PostToolUse)
```

**Scores emitted per turn:** `tool_call_count`, `turn_count`, `tool_success_rate`, `session_had_errors`

**Tags:** `harness:codex`, `model:{model}`, `repo:{repo}` (repo from git remote at SessionStart)

**Metadata:** `harness`, `sessionId`, `cwd`, `repo`, `repoRemote`, `gitBranch`, `gitCommit`, `model`,
plus Codex-specific: `codexSessionId`, `codexTurnId`, `permissionMode`, `transcriptPath`

## Configuration

Create a local config file outside the plugin repo:

```sh
mkdir -p ~/.codex/codex-langfuse
chmod 700 ~/.codex/codex-langfuse
cat > ~/.codex/codex-langfuse/config.json <<'JSON'
{
  "publicKey": "pk-lf-...",
  "secretKey": "sk-lf-...",
  "baseUrl": "https://cloud.langfuse.com",
  "environment": "development",
  "harness": "codex"
}
JSON
chmod 600 ~/.codex/codex-langfuse/config.json
```

Supported config fields:

| Field | Purpose |
| --- | --- |
| `publicKey` | Langfuse public key |
| `secretKey` | Langfuse secret key |
| `baseUrl` | Langfuse base URL, default `https://cloud.langfuse.com` |
| `environment` | Langfuse environment field |
| `harness` | Value written to trace metadata as `harness`; default `codex` |
| `userId` | Override Langfuse `userId` |
| `release` | Langfuse release field |
| `version` | Langfuse version field |
| `stateDir` | State directory, default `~/.codex/codex-langfuse` |
| `includePreToolUse` | Set `true` to also send pre-tool events |
| `debug` | Set `true` to log hook errors to stderr |

For automation, env vars are still supported and override config-file values:
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`,
`LANGFUSE_HOST`, `LANGFUSE_BASEURL`, `LANGFUSE_ENVIRONMENT`,
`CODEX_LANGFUSE_HARNESS`, `CODEX_LANGFUSE_USER_ID`, `CODEX_LANGFUSE_RELEASE`,
`CODEX_LANGFUSE_VERSION`, `CODEX_LANGFUSE_STATE_DIR`,
`CODEX_LANGFUSE_INCLUDE_PRE_TOOL_USE`, and `CODEX_LANGFUSE_DEBUG`.

## Installation

### 1. Install the plugin in Codex

Point Codex at this directory as a local plugin, or copy it to wherever Codex
loads plugins from. Verify the plugin is active in the Codex `/hooks` UI.

### 2. Configure credentials

Create a config file (keep it outside the repo):

```sh
mkdir -p ~/.codex/codex-langfuse
chmod 700 ~/.codex/codex-langfuse
cat > ~/.codex/codex-langfuse/config.json <<'JSON'
{
  "publicKey": "pk-lf-...",
  "secretKey": "sk-lf-...",
  "baseUrl": "https://cloud.langfuse.com",
  "environment": "development",
  "harness": "codex"
}
JSON
chmod 600 ~/.codex/codex-langfuse/config.json
```

Env vars override config-file values:
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`,
`LANGFUSE_HOST`, `LANGFUSE_BASEURL`, `LANGFUSE_ENVIRONMENT`,
`CODEX_LANGFUSE_HARNESS`, `CODEX_LANGFUSE_USER_ID`, `CODEX_LANGFUSE_RELEASE`,
`CODEX_LANGFUSE_VERSION`, `CODEX_LANGFUSE_STATE_DIR`,
`CODEX_LANGFUSE_INCLUDE_PRE_TOOL_USE`, `CODEX_LANGFUSE_DEBUG`.

## Hooks

The plugin listens for:

| Hook | Action |
| --- | --- |
| `SessionStart` | Captures git context (`repo`, `repoRemote`, `gitBranch`, `gitCommit`) from `cwd` and stores in session state for use by all subsequent events |
| `UserPromptSubmit` | Creates the per-turn trace with the user prompt as input |
| `PreToolUse` | Optional: records a tool-start event (enable with `includePreToolUse: true`) |
| `PostToolUse` | Records a tool-result event; increments per-turn tool/error counters |
| `Stop` | Updates the turn trace with assistant output, creates a generation, emits evaluation scores |
| `SessionEnd` | Records a session-end event |

The hook never blocks Codex. Missing credentials, network failures, and Langfuse
errors are swallowed unless `CODEX_LANGFUSE_DEBUG=1` is set.

## Notes

Codex hook support is version and feature-flag dependent. If plugin hooks are not
running in your Codex build, enable the relevant Codex hook feature and verify
the hook in the Codex `/hooks` UI.
