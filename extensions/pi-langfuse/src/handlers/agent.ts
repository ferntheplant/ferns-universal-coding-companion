import { state, resetRunState, computeEvaluationScores } from "../state.js";
import { getRuntime, sendScore } from "../langfuse.js";
import { ensureConfig } from "../config.js";
import { shapePayload, truncate, extractFinalAssistant, extractAssistantOutput } from "../utils.js";
import { closeDanglingObservations } from "./tool.js";
import { getGitContext } from "../git.js";

export function updateTraceIO(input?: unknown, output?: unknown) {
  const root = state.agentState?.root;
  if (!root?.setTraceIO) {
    return;
  }

  try {
    root.setTraceIO({ input, output });
  } catch {
    // Older SDKs may omit setTraceIO; root IO still mirrors trace IO in current Langfuse.
  }
}

export async function startAgentRun(event: Record<string, unknown>, ctx: any) {
  if (!(await ensureConfig(ctx))) {
    state.isTracingDisabled = true;
    return;
  }

  try {
    const rt = await getRuntime();
    const cwd = String(
      (event.systemPromptOptions && typeof event.systemPromptOptions === "object"
        ? (event.systemPromptOptions as Record<string, unknown>).cwd
        : undefined) ?? process.cwd(),
    );

    if (!state.currentModel && ctx.model) {
      state.currentModel = ctx.model.id || "";
      state.currentProvider = ctx.model.provider || "";
    }

    let systemPrompt = undefined;
    try {
      if (ctx.getSystemPrompt) {
        systemPrompt = await ctx.getSystemPrompt();
      }
    } catch {
      // Ignore if getSystemPrompt is not available or fails
    }

    const promptInput = shapePayload({
      prompt: event.prompt,
      images: event.images,
      context: event.context ?? event.attachments,
    });

    const gitContext = await getGitContext(cwd);

    state.agentState = {
      cwd,
      gitContext,
      promptInput,
      generationSeq: 0,
      activeGenerations: new Map(),
      generationOrder: [],
      activeTools: new Map(),
      providerMetadataByRequest: new Map(),
    };

    const traceTags = [
      "harness:pi",
      ...(state.currentModel ? [`model:${truncate(state.currentModel, 100)}`] : []),
      ...(gitContext.repo ? [`repo:${gitContext.repo}`] : []),
    ];

    const root = rt.propagateAttributes(
      {
        sessionId: state.currentSessionId ? truncate(state.currentSessionId, 200) : undefined,
        traceName: "pi:agent",
        tags: traceTags,
        metadata: {
          cwd: truncate(cwd, 200),
          ...(state.currentModel ? { model: truncate(state.currentModel, 200) } : {}),
          ...(state.currentProvider ? { provider: truncate(state.currentProvider, 200) } : {}),
        },
      },
      () =>
        rt.startObservation(
          "pi:agent",
          {
            input: promptInput,
            metadata: {
              harness: "pi",
              cwd,
              model: state.currentModel || undefined,
              provider: state.currentProvider || undefined,
              sessionId: state.currentSessionId || undefined,
              repo: gitContext.repo,
              repoRemote: gitContext.repoRemote,
              gitBranch: gitContext.gitBranch,
              gitCommit: gitContext.gitCommit,
              ...(systemPrompt ? { systemPrompt: truncate(String(systemPrompt), 20000) } : {}),
            },
          },
          { asType: "agent" },
        ),
    );

    state.agentState.root = root;
    state.agentState.traceId = root.traceId;
    updateTraceIO(promptInput, undefined);
  } catch (e) {
    console.warn("📊 Langfuse: Failed to create agent observation", e);
    state.isTracingDisabled = true;
  }
}

export async function finishAgentRun(event: Record<string, unknown> = {}) {
  if (!state.agentState?.root) {
    resetRunState();
    return;
  }

  const lastAssistant = extractFinalAssistant(event.messages);
  const output = lastAssistant ? extractAssistantOutput(lastAssistant) : state.agentState.latestAssistantOutput;
  const scores = computeEvaluationScores();

  closeDanglingObservations("Agent run ended before observation finalized");

  try {
    state.agentState.root
      .update({
        output,
        metadata: {
          harness: "pi",
          cwd: state.agentState.cwd,
          sessionId: state.currentSessionId || undefined,
          completed: true,
          model: state.currentModel || undefined,
          provider: state.currentProvider || undefined,
          totalTools: state.toolCallCount,
          ...state.agentState.gitContext,
          ...scores,
        },
      })
      .end();
    updateTraceIO(state.agentState.promptInput, output);

    await sendScore("tool_call_count", scores.tool_call_count, { traceId: state.agentState.traceId });
    await sendScore("turn_count", scores.turn_count, { traceId: state.agentState.traceId });
    await sendScore("total_tool_errors", scores.total_tool_errors, { traceId: state.agentState.traceId });
    await sendScore("tool_success_rate", scores.tool_success_rate, { traceId: state.agentState.traceId });
    await sendScore("session_had_errors", scores.session_had_errors, { traceId: state.agentState.traceId });
  } catch (e) {
    console.warn("📊 Langfuse: Failed to finish agent observation", e);
  } finally {
    resetRunState();
  }
}
