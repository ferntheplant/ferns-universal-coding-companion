# claude-code-langfuse

Claude Code hook plugin that sends agent traces to Langfuse. Runs as a `Stop` hook: after each conversation turn, reads the session transcript incrementally and emits one hierarchical Langfuse trace per turn:

```
claude-code:turn
  └─ claude-code:generation  (one per assistant message)
       └─ claude-code:tool:{name}  (one per tool call)
```

Implements the [shared trace schema](../../README.md#observability) — every trace carries `harness`, `sessionId`, `cwd`, `repo`, `repoRemote`, `gitBranch`, `gitCommit`, and `model` metadata plus normalized `harness:claude-code`, `model:…`, `repo:…` tags.

## Prerequisites

- Python 3.9+
- `langfuse` Python SDK v4.x with OpenTelemetry support:

```bash
pip install "langfuse>=4.0,<5" opentelemetry-api
```

## Installation

### 1. Configure credentials

Set these environment variables (or inline them in the hook command below):

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"   # or your self-hosted URL
```

### 2. Wire the Stop hook in `~/.claude/settings.json`

Add a `hooks` block pointing at the script. Credentials can be inlined in the command or read from your environment:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... LANGFUSE_BASE_URL=https://cloud.langfuse.com python3 /path/to/plugins/claude-code-langfuse/hooks/langfuse_hook.py",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/` with the absolute path to this repo. If you cloned into `~/withco/ferns-universal-coding-companion`, the path is:

```
/Users/<you>/withco/ferns-universal-coding-companion/plugins/claude-code-langfuse/hooks/langfuse_hook.py
```

### 3. Disable the marketplace plugin (if installed)

If you previously installed the `langfuse@langfuse-observability` marketplace plugin, disable it to avoid double-tracing:

```json
{
  "enabledPlugins": {
    "langfuse@langfuse-observability": false
  }
}
```

### 4. Reload Claude Code

Restart Claude Code or run `/reload-plugins`. The next conversation stop will emit a trace.

## Configuration

| Env var | Description | Default |
| --- | --- | --- |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key | — (required) |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key | — (required) |
| `LANGFUSE_BASE_URL` | Langfuse base URL | `https://us.cloud.langfuse.com` |
| `CC_LANGFUSE_DEBUG` | Set `"true"` to write debug logs to `~/.claude/state/langfuse_hook.log` | `false` |
| `CC_LANGFUSE_MAX_CHARS` | Max characters before text is truncated | `20000` |

Plugin option equivalents (`CLAUDE_PLUGIN_OPTION_*`) are also read, so the plugin can be wired as a Claude Code marketplace plugin if preferred.

## What gets traced

**Per turn:**
- Trace `claude-code:turn` with the user's message as input and the final assistant message as output
- Tags: `harness:claude-code`, `model:{model}`, `repo:{repo}`
- Metadata: all shared schema fields + `cwd`, `gitBranch`, `gitCommit`, `sessionId`

**Per assistant message within a turn:**
- Generation `claude-code:generation` with the LLM input, output (text + tool calls), model, and token usage

**Per tool call:**
- Span `claude-code:tool:{name}` with the tool input and result, nested under its generation

**Scores per turn:**
- `tool_call_count` — total tool calls
- `turn_count` — always 1 (per-turn score)
- `tool_success_rate` — tool results / tool calls

## State and logs

- Session state: `~/.claude/state/langfuse_state.json` — tracks transcript read position per session; entries older than 30 days are pruned automatically
- Debug log: `~/.claude/state/langfuse_hook.log` — written when `CC_LANGFUSE_DEBUG=true`

The hook is non-blocking: errors are swallowed unless debug mode is on, and Langfuse flush is capped at 5 seconds so a slow or unreachable server can't stall Claude Code.
