import { PromptRegistry } from "./prompt-registry";

export interface RuntimeState {
  startedAt: number;
  commandCount: number;
}

const runtimeState: RuntimeState = {
  startedAt: Date.now(),
  commandCount: 0,
};

const promptRegistry = new PromptRegistry();

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
  };
}

export function resetRuntimeState(): void {
  runtimeState.startedAt = Date.now();
  runtimeState.commandCount = 0;
  promptRegistry.reset();
}
