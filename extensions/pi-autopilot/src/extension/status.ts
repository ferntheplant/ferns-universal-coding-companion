import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutopilotPhase, RunState } from "./types";

/**
 * Operator-facing state surfaces: the cmux sidebar (cross-workspace) and the
 * in-session widget line. Pattern lifted from extensions/pi-cmux.
 *
 * TODO(phase 3): while armed, suppress pi-cmux's per-agent_end "needs
 * attention" status via a flag on pi.events so the two don't fight over the
 * sidebar.
 */

const STATUS_KEY = "pi-autopilot";

interface SidebarStyle {
  message: string;
  icon: string;
  color: string;
  priority: string;
}

const SIDEBAR_STYLES: Record<AutopilotPhase, SidebarStyle | null> = {
  idle: null,
  working: {
    message: "autopilot: working",
    icon: "circle.dotted",
    color: "#8888ff",
    priority: "40",
  },
  gating: {
    message: "autopilot: running gates",
    icon: "gearshape",
    color: "#8888ff",
    priority: "40",
  },
  paused: { message: "autopilot: paused", icon: "pause.circle", color: "#aaaaaa", priority: "50" },
  needs_human: {
    message: "autopilot: needs you",
    icon: "exclamationmark.triangle",
    color: "#ff9500",
    priority: "90",
  },
  ready: {
    message: "autopilot: ready to merge",
    icon: "checkmark.circle",
    color: "#34c759",
    priority: "70",
  },
};

function inCmux(): boolean {
  return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID);
}

export async function updateSidebar(
  pi: ExtensionAPI,
  phase: AutopilotPhase,
  detail?: string,
): Promise<void> {
  if (!inCmux()) return;
  const style = SIDEBAR_STYLES[phase];
  if (!style) {
    await clearSidebar(pi);
    return;
  }
  const message = detail ? `${style.message} — ${detail}` : style.message;
  await pi
    .exec(
      "cmux",
      [
        "set-status",
        STATUS_KEY,
        message,
        "--icon",
        style.icon,
        "--color",
        style.color,
        "--priority",
        style.priority,
      ],
      { timeout: 5000 },
    )
    .catch(() => {});
}

export async function clearSidebar(pi: ExtensionAPI): Promise<void> {
  if (!inCmux()) return;
  await pi.exec("cmux", ["clear-status", STATUS_KEY], { timeout: 5000 }).catch(() => {});
}

/** One-line widget above the editor: phase, gate cursor, attempts, reason. */
export function updateWidget(ctx: ExtensionContext, run: RunState | null, gates: string[]): void {
  if (!ctx.hasUI) return;
  if (!run) {
    ctx.ui.setWidget(STATUS_KEY, undefined);
    return;
  }
  const parts: string[] = [`autopilot: ${run.phase}`];
  if (run.phase === "gating") {
    const gateId = gates[run.gateCursor];
    if (gateId) {
      const used = run.attempts[gateId] ?? 0;
      parts.push(`gate ${run.gateCursor + 1}/${gates.length} (${gateId}, attempt ${used + 1})`);
    }
  }
  if (run.gateNote) {
    parts.push(run.gateNote);
  }
  if (run.phase === "needs_human" && run.needsHumanReason) {
    parts.push(run.needsHumanReason);
  }
  ctx.ui.setWidget(STATUS_KEY, [parts.join(" · ")], { placement: "belowEditor" });
}
