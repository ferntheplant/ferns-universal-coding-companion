import { PromptRegistry } from "./prompt-registry";

export interface RuntimeState {
  startedAt: number;
  commandCount: number;
  lastApplied?: LastAppliedPromptState;
}

export interface LastAppliedPromptState {
  appliedAt: number;
  modelKey?: string;
  matchedFiles: string[];
  appendedCharacters: number;
  outcome: "applied" | "no-model" | "no-match" | "error";
  detail: string;
}

const runtimeState: RuntimeState = {
  startedAt: Date.now(),
  commandCount: 0,
};

const promptRegistry = new PromptRegistry();
const seenWarnings = new Set<string>();

export function getPromptRegistry(): PromptRegistry {
  return promptRegistry;
}

export function incrementCommandCount(): void {
  runtimeState.commandCount += 1;
}

export function getRuntimeStatus(): RuntimeState {
  return {
    startedAt: runtimeState.startedAt,
    commandCount: runtimeState.commandCount,
    lastApplied: runtimeState.lastApplied,
  };
}

export function setLastAppliedPromptState(state: LastAppliedPromptState): void {
  runtimeState.lastApplied = state;
}

export function recordWarnings(warnings: string[]): string[] {
  const unseen: string[] = [];

  for (const warning of warnings) {
    if (seenWarnings.has(warning)) {
      continue;
    }

    seenWarnings.add(warning);
    unseen.push(warning);
  }

  return unseen;
}

export function resetRuntimeState(): void {
  runtimeState.startedAt = Date.now();
  runtimeState.commandCount = 0;
  runtimeState.lastApplied = undefined;
  promptRegistry.reset();
  seenWarnings.clear();
}
