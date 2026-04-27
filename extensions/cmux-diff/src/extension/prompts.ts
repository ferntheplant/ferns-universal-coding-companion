import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { PaneInfo } from "../domain/cmux";
import type { DiffTarget } from "../domain/diff-target";

export type DiffTargetPromptResult = DiffTarget;

export type CmuxPaneSelection =
  | { kind: "new-pane" }
  | { kind: "existing-pane"; paneId: string };

export type CmuxModePromptResult = {
  selection: CmuxPaneSelection;
};

export async function promptForDiffTarget(ctx: ExtensionCommandContext): Promise<DiffTargetPromptResult> {
  const selected = await ctx.ui.select("Choose diff target", ["uncommitted", "branch", "commit"]);
  if (!selected) {
    throw new Error("Cancelled diff target selection.");
  }

  if (selected === "uncommitted") {
    return { kind: "uncommitted" };
  }

  if (selected === "branch") {
    const value = await ctx.ui.input("Branch to compare against", "main");
    if (!value) {
      throw new Error("Cancelled branch target input.");
    }

    return {
      kind: "branch",
      value: value.trim(),
    };
  }

  const value = await ctx.ui.input("Commit to compare against", "HEAD~1");
  if (!value) {
    throw new Error("Cancelled commit target input.");
  }

  return {
    kind: "commit",
    value: value.trim(),
  };
}

export async function promptForCmuxMode(ctx: ExtensionCommandContext, pi: ExtensionAPI, availablePanes: PaneInfo[]): Promise<CmuxModePromptResult> {
  const { listCmuxPanes } = await import("../domain/cmux");

  // Build selection options with semantic labels
  const options: Array<{ label: string; value: CmuxPaneSelection }> = [
    { label: "🆕 Open in new pane", value: { kind: "new-pane" } },
  ];

  // Add existing panes with semantic labels
  for (const pane of availablePanes) {
    options.push({
      label: `📋 ${pane.label}`,
      value: { kind: "existing-pane", paneId: pane.id },
    });
  }

  // If we didn't get panes from the caller, try to fetch them directly
  if (availablePanes.length === 0) {
    try {
      const paneResult = await listCmuxPanes(pi);
      if (paneResult.success && paneResult.panes.length > 0) {
        // Rebuild options with fetched panes
        options.length = 1; // Keep only the "new pane" option
        for (const pane of paneResult.panes) {
          options.push({
            label: `📋 ${pane.label}`,
            value: { kind: "existing-pane", paneId: pane.id },
          });
        }
      }
    } catch {
      // Ignore fetch errors, proceed with just "new pane" option
    }
  }

  const labels = options.map((o) => o.label);
  const selected = await ctx.ui.select("Choose where to open the diff review", labels);
  if (!selected) {
    throw new Error("Cancelled cmux mode selection.");
  }

  const selectedIndex = labels.indexOf(selected);
  const selection = options[selectedIndex]?.value ?? { kind: "new-pane" };

  return { selection };
}
