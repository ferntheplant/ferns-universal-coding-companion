import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Cross-extension signaling over the shared pi.events bus. pi-cmux listens on
 * this channel and suppresses its per-agent_end "needs attention" sidebar
 * status while autopilot owns the workspace status.
 */
export const ARMED_CHANNEL = "pi-autopilot:armed";

export function emitArmedState(pi: ExtensionAPI, armed: boolean): void {
  pi.events.emit(ARMED_CHANNEL, { armed });
}
