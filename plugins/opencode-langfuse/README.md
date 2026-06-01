# opencode-langfuse

Langfuse observability plugin for [OpenCode](https://opencode.ai). Stamps every
OTEL span with the [shared trace schema](../../README.md#observability) metadata
so OpenCode traces are comparable to Pi, Codex, and Claude Code runs in one
Langfuse project.

## What it adds to each span

At plugin startup the plugin runs `git` synchronously to capture context from
`process.cwd()` and stamps every span with:

- `langfuse.trace.metadata.harness` → `"opencode"`
- `langfuse.trace.metadata.cwd`
- `langfuse.trace.metadata.repo`
- `langfuse.trace.metadata.repoRemote`
- `langfuse.trace.metadata.gitBranch`
- `langfuse.trace.metadata.gitCommit`
- `langfuse.trace.metadata.sessionId` — captured from the first opencode session event
- `langfuse.trace.tags` → `["harness:opencode", "repo:{repo}"]`

Note: OpenCode's OTEL bridge controls the span hierarchy and model/token fields;
this plugin stamps context on top of whatever OpenCode emits. Scores are not
emitted (no hook-level access to tool results).

## Installation

### 1. Enable OTEL in `opencode.json`

```json
{
  "experimental": { "openTelemetry": true }
}
```

### 2. Add the plugin

In your `opencode.json` (or `.opencode/opencode.json`):

```json
{
  "experimental": { "openTelemetry": true },
  "plugin": [
    [
      "/path/to/plugins/opencode-langfuse/src/index.ts",
      {
        "publicKey": "pk-lf-...",
        "secretKey": "sk-lf-...",
        "baseUrl": "https://cloud.langfuse.com",
        "environment": "development"
      }
    ]
  ]
}
```

All option fields are optional and fall back, in order, to:

| Option        | Env var                | Default                       |
| ------------- | ---------------------- | ----------------------------- |
| `publicKey`   | `LANGFUSE_PUBLIC_KEY`  | — (required)                  |
| `secretKey`   | `LANGFUSE_SECRET_KEY`  | — (required)                  |
| `baseUrl`     | `LANGFUSE_BASEURL`     | `https://cloud.langfuse.com`  |
| `environment` | `LANGFUSE_ENVIRONMENT` | `development`                 |
| `harness`     | `LANGFUSE_HARNESS`     | `"opencode"`                  |

If `publicKey` or `secretKey` resolves to empty, tracing is disabled and a
warning is logged.

`experimental.openTelemetry` must be `true` in the opencode config for spans to
actually be emitted; the plugin will warn otherwise.
