import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getConfig, handleHookPayload } from "../scripts/langfuse-hook.mjs";

function memoryStore() {
  const states = new Map();
  return {
    async read(sessionId) {
      return structuredClone(states.get(sessionId) ?? { turns: {} });
    },
    async write(sessionId, state) {
      states.set(sessionId, structuredClone(state));
    },
    async remove(sessionId) {
      states.delete(sessionId);
    },
    states,
  };
}

const config = {
  publicKey: "pk-lf-test",
  secretKey: "sk-lf-test",
  baseUrl: "https://cloud.langfuse.com",
  userId: "tester",
  harness: "codex",
  stateDir: "/tmp/codex-langfuse-test",
};

test("uses Codex session id as Langfuse sessionId", async () => {
  const store = memoryStore();
  const sent = [];
  const transport = async (_config, body) => sent.push(body);

  await handleHookPayload(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "codex-session-1",
      turn_id: "turn-1",
      prompt: "implement tracing",
      cwd: "/repo",
      model: "gpt-5.4",
    },
    { config, stateStore: store, transport, now: () => "2026-06-01T00:00:00.000Z" },
  );

  const trace = sent[0].batch.find((event) => event.type === "trace-create");
  assert.equal(trace.body.sessionId, "codex-session-1");
  assert.equal(trace.body.metadata.codexSessionId, "codex-session-1");
  assert.equal(trace.body.metadata.codexTurnId, "turn-1");
  assert.equal(trace.body.metadata.harness, "codex");
  assert.deepEqual(trace.body.tags, ["harness:codex", "model:gpt-5.4"]);
  assert.equal(trace.body.input, "implement tracing");
});

test("uses configured harness in metadata and tags", async () => {
  const store = memoryStore();
  const sent = [];
  const transport = async (_config, body) => sent.push(body);

  await handleHookPayload(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "codex-session-1",
      turn_id: "turn-1",
      prompt: "implement tracing",
    },
    {
      config: { ...config, harness: "codex-nightly" },
      stateStore: store,
      transport,
      now: () => "2026-06-01T00:00:00.000Z",
    },
  );

  const trace = sent[0].batch.find((event) => event.type === "trace-create");
  const event = sent[0].batch.find((entry) => entry.type === "event-create");

  assert.equal(trace.body.metadata.harness, "codex-nightly");
  assert.deepEqual(trace.body.tags, ["harness:codex-nightly"]);
  assert.equal(event.body.metadata.harness, "codex-nightly");
});

test("updates the same turn trace on Stop with assistant output", async () => {
  const store = memoryStore();
  const sent = [];
  const transport = async (_config, body) => sent.push(body);

  await handleHookPayload(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "codex-session-1",
      turn_id: "turn-1",
      prompt: "build it",
      model: "gpt-5.4",
    },
    { config, stateStore: store, transport, now: () => "2026-06-01T00:00:00.000Z" },
  );
  await handleHookPayload(
    {
      hook_event_name: "Stop",
      session_id: "codex-session-1",
      turn_id: "turn-1",
      last_assistant_message: "done",
      model: "gpt-5.4",
    },
    { config, stateStore: store, transport, now: () => "2026-06-01T00:00:03.000Z" },
  );

  const firstTrace = sent[0].batch.find((event) => event.type === "trace-create");
  const stopTrace = sent[1].batch.find((event) => event.type === "trace-create");
  const generation = sent[1].batch.find((event) => event.type === "generation-create");

  assert.equal(stopTrace.body.id, firstTrace.body.id);
  assert.equal(stopTrace.body.sessionId, "codex-session-1");
  assert.equal(stopTrace.body.output, "done");
  assert.equal(generation.body.traceId, firstTrace.body.id);
  assert.equal(generation.body.input, "build it");
  assert.equal(generation.body.output, "done");
});

test("skips ingestion when credentials are missing", async () => {
  let calls = 0;
  const result = await handleHookPayload(
    { hook_event_name: "SessionStart", session_id: "session" },
    {
      config: { ...config, publicKey: undefined },
      stateStore: memoryStore(),
      transport: async () => {
        calls += 1;
      },
    },
  );

  assert.deepEqual(result, { skipped: "missing-credentials" });
  assert.equal(calls, 0);
});

test("loads credentials from config file without environment variables", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-langfuse-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      publicKey: "pk-from-file",
      secretKey: "sk-from-file",
      baseUrl: "https://langfuse.example.com/",
      environment: "test",
      harness: "codex-local",
      debug: true,
      includePreToolUse: true,
    }),
    "utf8",
  );

  try {
    const loaded = await getConfig({
      CODEX_LANGFUSE_CONFIG: configPath,
      USER: "tester",
    });

    assert.equal(loaded.publicKey, "pk-from-file");
    assert.equal(loaded.secretKey, "sk-from-file");
    assert.equal(loaded.baseUrl, "https://langfuse.example.com");
    assert.equal(loaded.environment, "test");
    assert.equal(loaded.harness, "codex-local");
    assert.equal(loaded.debug, true);
    assert.equal(loaded.includePreToolUse, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
