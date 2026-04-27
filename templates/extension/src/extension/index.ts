import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function exampleExtension(pi: ExtensionAPI): void {
  pi.registerCommand("example-extension", {
    description: "Hello-world command for the example extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Hello from example-extension!", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("example-extension loaded.", "info");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {});
}
