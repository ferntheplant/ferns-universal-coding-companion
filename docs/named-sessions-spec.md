# Named Sessions Spec

Unified session naming between Pi's native session system and pi-context.

## Status

Completed on 2026-04-21.

Implemented as specified, with one command-name adjustment to avoid a built-in Pi command conflict:

- shipped command: `/pi-context-name <label>`
- equivalent behavior to the originally proposed `/name <label>`

## Goals

1. **`/name <label>` command** — user names the current session from the Pi prompt
2. **Statusline display** — the name appears in Pi's footer via `ctx.ui.setStatus()`
3. **pi-context uses Pi session IDs directly** — stop deriving synthetic conversation IDs; use `ctx.sessionManager.getSessionId()` as the canonical ID
4. **pi-context UI shows session names** — the dashboard displays user-given names alongside auto-extracted labels
5. **Tree branch handling** — deferred to a later phase

---

## Pi Session Identity (recap)

Pi sessions live at `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`. The session header is the first JSONL line:

```json
{
  "type": "session",
  "version": 3,
  "id": "019db17a-c9df-759f-8516-82f67de54edf",
  "timestamp": "2026-04-21T19:18:27.551Z",
  "cwd": "/Users/fjorn/withco/pi-extensions"
}
```

The `id` field is a UUID (UUIDv7, time-ordered). This is the value returned by `ctx.sessionManager.getSessionId()`. When Pi forks or clones a session, the new session gets a fresh UUID and an optional `parentSession` pointer in its header.

---

## 1. `/name` command

### Registration

Register in `commands.ts` via `pi.registerCommand()`:

```typescript
pi.registerCommand("name", {
  description: "Name the current session for later recall",
  async handler(args, ctx) {
    const name = args.trim();
    if (!name) {
      // Read the current name
      const current = pi.getSessionName();
      if (current) {
        notifyInfo(ctx, `Session name: ${current}`);
      } else {
        notifyInfo(ctx, "No session name set. Usage: /name <label>");
      }
      return;
    }

    pi.setSessionName(name);

    // Persist to session file as a custom entry so the name survives reload
    await pi.appendEntry("pi-context:session-name", { name });

    // Update the statusline
    ctx.ui.setStatus("pi-context-name", name);

    // Notify the sidecar so pi-context can update its stored conversation label
    await notifySidecarOfName(ctx, name);

    notifySuccess(ctx, `Session named: ${name}`);
  },
});
```

### Behavior

- `/name refactor-auth` — sets the session name to "refactor-auth"
- `/name` with no args — prints the current name, or usage hint if none set
- The name is persisted two ways:
  1. **Pi-native**: `pi.setSessionName(name)` sets it on the Pi session object
  2. **Custom entry**: `pi.appendEntry("pi-context:session-name", { name })` writes a `custom` entry to the JSONL file so the name survives session reload and is visible to any tool that reads the session file directly

### Restoring the name on session resume

When `session_start` fires, the extension should:

1. Call `pi.getSessionName()` — if non-empty, restore the statusline and notify the sidecar
2. This handles cases where the user resumes a previously-named session

```typescript
pi.on("session_start", async (_event, ctx) => {
  startSessionCapture(ctx);

  const existingName = pi.getSessionName();
  if (existingName) {
    ctx.ui.setStatus("pi-context-name", existingName);
    await notifySidecarOfName(ctx, existingName);
  }
});
```

---

## 2. Statusline display

Use `ctx.ui.setStatus(id, text)` to show the session name in Pi's footer area.

- **Status ID**: `"pi-context-name"` — a stable key so updates replace rather than append
- **Format**: just the raw name string (e.g. `refactor-auth`); keep it short since footer space is limited
- **When to set**: on `/name`, on `session_start` if a name exists
- **When to clear**: not needed — if the user starts a new session, the status resets with the new session context

---

## 3. pi-context uses Pi session IDs directly

### Current behavior (to be replaced)

`store.ts:361-394` uses a heuristic to group Pi turns into conversations:

- Fingerprint = hash of system prompt + working directory
- Split on 5-minute inactivity TTL or >50% context token shrinkage
- Conversation ID = `SHA256(fingerprint + timestamp).slice(0, 16)` — a synthetic 16-char hex string

This was necessary because pi-context originally had no access to Pi's session identity. But the extension already captures `ctx.sessionManager.getSessionId()` and passes it through as `sessionId` on the `SpikeTurnRecord`, which arrives at the sidecar as `turn.sessionId` in `pi-ingest.ts:85`.

### New behavior

Use the Pi session UUID directly as the pi-context `conversationId` for Pi-sourced turns.

#### Changes to `pi-ingest.ts`

The pipeline already extracts `turn.sessionId`. Instead of using it only as a rolling-state key, pass it through to `store.storeRequest()` as the authoritative conversation ID:

```typescript
// pi-ingest.ts — ingest()
const entry = this.store.storeRequest(
  contextInfo,
  syntheticResponse,
  "pi",
  requestBody as Record<string, any>,
  meta,
  {},
  traceId, // keep for LHAR trace derivation
  turn.sessionId, // NEW: pass Pi session UUID as conversationId hint
);
```

#### Changes to `store.ts`

Add an optional `piSessionId` parameter to `storeRequest()`. When present and source is `"pi"`, skip the fingerprint/TTL heuristic entirely:

```typescript
// In the Pi session grouping block (lines 361-394), replace with:
} else if (resolvedSource === "pi" && piSessionId) {
  // Use Pi's native session UUID directly — no heuristic splitting.
  conversationId = piSessionId;
} else if (fingerprint && resolvedSource === "pi") {
  // Fallback: legacy heuristic for turns without a session ID
  // (shouldn't happen with the extension, but keeps non-extension
  // ingest paths working)
  // ... existing TTL/shrinkage logic unchanged ...
}
```

The `piSessionTracker` map and `PI_SESSION_TTL_MS` constant can be kept for the fallback path but will not fire for extension-sourced turns.

#### Changes to `Conversation` type

Add an optional `name` field to `types.ts`:

```typescript
export interface Conversation {
  id: string; // Pi session UUID (for Pi source)
  label: string; // Auto-extracted from first message
  name?: string | null; // User-given name via /name
  source: string;
  workingDirectory: string | null;
  firstSeen: string;
  sessionId?: string | null;
  tags?: string[];
  prunedMessages?: string[];
}
```

When `id === sessionId` (as it will for Pi-sourced conversations), the two fields are redundant — `sessionId` can remain for backwards compat but the canonical identity is now `id`.

#### Trace ID derivation

`traceIdFromConversation()` in `lhar/record.ts` already hashes any string into a 32-char trace ID. Feeding it a UUID instead of a synthetic hex string changes the output but the function itself is unchanged. Existing LHAR exports will get new trace IDs — this is acceptable since the old synthetic IDs had no stable meaning anyway.

---

## 4. Sidecar name notification

### New endpoint: `POST /api/session/name`

Add a small endpoint to `api.ts` for the extension to push name updates:

```typescript
app.post("/api/session/name", async (c) => {
  const { sessionId, name } = await c.req.json();
  if (!sessionId || typeof name !== "string") {
    return c.json({ error: "sessionId and name required" }, 400);
  }

  const conversation = store.getConversation(sessionId);
  if (conversation) {
    conversation.name = name.trim() || null;
    store.persistConversation(conversation);
    return c.json({ ok: true });
  }

  // Session not yet seen — store the name for when it arrives
  store.setPendingName(sessionId, name.trim());
  return c.json({ ok: true, pending: true });
});
```

The extension calls this from the `/name` handler:

```typescript
async function notifySidecarOfName(ctx: ExtensionContext, name: string): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();
  const sidecarUrl = getSidecarUrl();
  if (!sidecarUrl) return;

  try {
    await fetch(`${sidecarUrl}/api/session/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, name }),
    });
  } catch {
    // Best-effort — sidecar may not be running
  }
}
```

### Pending names

If `/name` is called before any turns have been captured (so the sidecar hasn't seen the session yet), the sidecar stores the name in a `pendingNames: Map<string, string>`. When `storeRequest()` creates a new `Conversation` with that `sessionId`, it checks `pendingNames` and applies the name.

---

## 5. pi-context UI changes

### Dashboard conversation list

The conversation list in the pi-context dashboard currently shows the auto-extracted `label` (first user message snippet). Update to prefer `name` when present:

```
Display logic:
  if (conversation.name)  → show name (bold) + label as subtitle
  else                    → show label as before
```

### Searchability

The dashboard search should match against both `name` and `label`. Named sessions should rank higher in results since the user explicitly tagged them.

### LHAR session records

The LHAR session line (`buildLharSessionRecord` in `lhar/record.ts`) should include the name in its metadata if present:

```typescript
return {
  type: "session",
  trace_id: traceIdFromConversation(conversationId),
  started_at: conversation.firstSeen,
  tool: conversation.source,
  model: "...",
  metadata: {
    ...(conversation.name ? { name: conversation.name } : {}),
  },
};
```

---

## 6. Session forks and clones

When Pi forks or clones a session (`/fork`, `/clone`), it creates a new session file with a fresh UUID and a `parentSession` field pointing to the original file. The extension will see a new `session_start` event with a new `ctx.sessionManager.getSessionId()`.

This works naturally with the new model:

- The forked session gets its own `conversationId` (the new UUID)
- It starts as a separate conversation in pi-context
- If the user `/name`s it, it gets its own name
- The `parentSession` relationship is not currently tracked in pi-context but could be added later as a `parentConversationId` field on `Conversation`

---

## 7. Tree branch handling (DEFERRED)

### The problem

Pi sessions support a tree structure: users can `/tree` to navigate back to an earlier entry and branch from there. A single `.jsonl` file can contain multiple divergent conversation paths. The active path at any moment is determined by following the `parentId` chain from the current head entry back to root.

pi-context currently only sees turns as they happen on the active branch. It has no visibility into:

- Which branch is active
- When the user switches branches
- The full tree topology

### Why this is hard

1. **No branch-switch event** — Pi doesn't emit an extension event when the user navigates the tree. The extension would need to poll or read the session file directly to detect branch changes.
2. **Shared prefixes** — two branches that diverge at turn 5 share turns 1-4. If pi-context creates separate conversations per branch, those shared turns would be duplicated.
3. **Token/cost attribution** — shared prefix turns would be double-counted across branches unless pi-context implements deduplication.

### Sketch of a future approach

A background "cleanup processor" that periodically:

1. Reads Pi session `.jsonl` files directly from `~/.pi/agent/sessions/`
2. Parses the tree structure (following `id`/`parentId` chains)
3. Identifies sessions with genuine branches (more than one leaf node)
4. For each distinct branch (root-to-leaf path):
   - Creates a pi-context conversation if one doesn't exist
   - Populates it with the turns along that path
   - Marks shared-prefix turns with a flag to avoid double-counting costs
5. Names derived branches as `<session-name>/branch-<N>` or similar

This processor would run on a timer (e.g. every 60 seconds) or on session close. It is explicitly **not part of the initial implementation**.

### What we lose by deferring

- If a user branches mid-session, pi-context sees one continuous conversation that "jumps" when the context changes. The analytics may show anomalies (e.g. token count drops) at the branch point.
- The existing context-shrinkage heuristic (>50% token drop) would have incorrectly split these into separate conversations under the old model. With the new model (Pi session ID = conversation ID), branches within a single session file stay as one conversation, which is arguably more correct — the split just isn't visible.

---

## Implementation order

1. **Add `name` field to `Conversation` type** and persistence — small, no behavioral change
2. **Register `/name` command** with `pi.setSessionName()`, `pi.appendEntry()`, and `ctx.ui.setStatus()`
3. **Add `POST /api/session/name` endpoint** to the sidecar
4. **Wire name restore on `session_start`** — read `pi.getSessionName()` and push to sidecar
5. **Switch Pi conversation ID to `sessionId`** — modify `store.ts` to use Pi session UUID directly, keep heuristic as fallback
6. **Update dashboard UI** — prefer `name` over `label`, add to search
7. **Update LHAR export** — include name in session metadata
