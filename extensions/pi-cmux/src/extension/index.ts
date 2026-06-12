import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "pi-cmux";
const ATTENTION_MESSAGE = "cmux workspace needs attention";

function inCmux(): boolean {
  return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID);
}

async function setCmuxSidebar(pi: ExtensionAPI): Promise<void> {
  await pi.exec(
    "cmux",
    [
      "set-status",
      STATUS_KEY,
      ATTENTION_MESSAGE,
      "--icon",
      "sparkle",
      "--color",
      "#ff9500",
      "--priority",
      "80",
    ],
    { timeout: 5000 },
  );
}

async function clearCmuxSidebar(pi: ExtensionAPI): Promise<void> {
  await pi.exec("cmux", ["clear-status", STATUS_KEY], { timeout: 5000 });
}

export default function piCmuxExtension(pi: ExtensionAPI): void {
  // While pi-autopilot is armed it owns the workspace status with richer
  // per-phase messages; suppress the generic attention ping until it disarms.
  let autopilotArmed = false;
  pi.events.on("pi-autopilot:armed", (data) => {
    autopilotArmed = Boolean((data as { armed?: boolean } | undefined)?.armed);
  });

  pi.registerCommand("pi-cmux-clear", {
    description: "Clear the cmux workspace attention status from sidebar",
    handler: async (_args, ctx) => {
      if (inCmux()) {
        await clearCmuxSidebar(pi).catch(() => {});
      }
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify("Sidebar attention status cleared.", "info");
    },
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (autopilotArmed) return;
    if (inCmux()) {
      await setCmuxSidebar(pi).catch(() => {});
    }
    ctx.ui.setStatus(STATUS_KEY, ATTENTION_MESSAGE);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (inCmux()) {
      await clearCmuxSidebar(pi).catch(() => {});
    }
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
