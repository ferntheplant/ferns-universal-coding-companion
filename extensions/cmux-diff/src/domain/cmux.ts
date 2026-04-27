import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type CmuxOpenMode = "new-pane" | "existing-pane";

export interface PaneInfo {
  id: string;
  label: string;
  type?: string;
  title?: string;
  isFocused?: boolean;
}

export interface OpenPaneOptions {
  url: string;
  mode: CmuxOpenMode;
  paneId?: string;
}

export interface CmuxCommand {
  command: string;
  args: string[];
}

export interface ListPanesResult {
  success: boolean;
  panes: PaneInfo[];
  error?: string;
}

function hasCmuxWorkspaceContext(): boolean {
  return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID);
}

export function ensureInCmuxEnvironment(): void {
  if (hasCmuxWorkspaceContext()) {
    return;
  }

  throw new Error(
    "cmux context not detected. Run /cmux-diff from a terminal inside cmux (CMUX_WORKSPACE_ID/CMUX_SURFACE_ID).",
  );
}

export async function ensureCmuxAvailable(pi: ExtensionAPI): Promise<void> {
  const result = await pi.exec("cmux", ["version"], { timeout: 5000 });
  if (result.code !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || "cmux command failed";
    throw new Error(`cmux is unavailable: ${details}`);
  }
}

export function buildCmuxOpenCommand({ url, mode, paneId }: OpenPaneOptions): CmuxCommand {
  if (mode === "new-pane") {
    return {
      command: "cmux",
      args: ["new-pane", "--type", "browser", "--url", url],
    };
  }

  if (mode === "existing-pane") {
    if (!paneId) {
      throw new Error("paneId is required when mode is 'existing-pane'");
    }
    return {
      command: "cmux",
      args: ["new-surface", "--type", "browser", "--pane", paneId, "--url", url],
    };
  }

  const exhaustive: never = mode;
  throw new Error(`Unsupported cmux mode: ${String(exhaustive)}`);
}

export async function openCmuxPane(pi: ExtensionAPI, opts: OpenPaneOptions): Promise<void> {
  const cmd = buildCmuxOpenCommand(opts);
  const result = await pi.exec(cmd.command, cmd.args, { timeout: 10_000 });

  if (result.code !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || "unknown error";
    throw new Error(`Failed to open cmux browser pane: ${details}`);
  }
}

/**
 * Parse cmux list-panes output which looks like:
 *   * pane:13  [1 surface]  [focused]
 *     pane:28  [1 surface]
 *     pane:44  [1 surface]
 */
function parseListPanesOutput(output: string): Array<{ id: string; isFocused: boolean }> {
  const panes: Array<{ id: string; isFocused: boolean }> = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("pane:") && !trimmed.startsWith("* pane:")) {
      continue;
    }

    const isFocused = trimmed.startsWith("* ");
    const content = isFocused ? trimmed.slice(2) : trimmed;

    // Extract pane ID: "pane:13  [1 surface]  [focused]" -> "pane:13"
    const match = content.match(/^(pane:\d+)/);
    if (match && match[1]) {
      panes.push({ id: match[1], isFocused });
    }
  }

  return panes;
}

/**
 * Parse cmux list-pane-surfaces output which looks like:
 *   * surface:27  π - cmux-diff  [selected]
 * or:
 *   surface:43  PLAN.md  [selected]
 *
 * Returns the title (second column) or undefined if not found.
 */
function parseSurfaceTitle(output: string): string | undefined {
  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match: "* surface:27  title  [selected]" or "surface:43  title  [selected]"
    const match = trimmed.match(/(?:\*\s+)?surface:\d+\s+(.+?)(?:\s+\[.+\])?$/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

export async function listCmuxPanes(pi: ExtensionAPI): Promise<ListPanesResult> {
  // Get list of panes
  const listResult = await pi.exec("cmux", ["list-panes"], { timeout: 5000 });

  if (listResult.code !== 0) {
    const details = listResult.stderr.trim() || listResult.stdout.trim() || "cmux list-panes failed";
    return { success: false, panes: [], error: details };
  }

  const parsedPanes = parseListPanesOutput(listResult.stdout);

  if (parsedPanes.length === 0) {
    return { success: true, panes: [] };
  }

  // Fetch surface info for all panes in parallel for faster startup
  const panePromises = parsedPanes.map(async ({ id, isFocused }) => {
    let title: string | undefined;
    let type: string | undefined;
    try {
      const surfaceResult = await pi.exec("cmux", ["list-pane-surfaces", "--pane", id], { timeout: 3000 });
      if (surfaceResult.code === 0) {
        title = parseSurfaceTitle(surfaceResult.stdout);
      }
    } catch {
      // Ignore errors fetching surface details
    }

    const label = buildPaneLabel({ id, title, type, isFocused });

    return {
      id,
      label,
      type,
      title,
      isFocused,
    };
  });

  const panes = await Promise.all(panePromises);

  // Sort focused pane first, then by ID
  panes.sort((a, b) => {
    if (a.isFocused && !b.isFocused) return -1;
    if (!a.isFocused && b.isFocused) return 1;
    return a.id.localeCompare(b.id);
  });

  return { success: true, panes };
}

export function buildPaneLabel(pane: Partial<PaneInfo>): string {
  const parts: string[] = [];

  if (pane.isFocused) {
    parts.push("★");
  }

  if (pane.title) {
    parts.push(pane.title);
  } else if (pane.type) {
    parts.push(pane.type);
  }

  if (pane.id) {
    parts.push(`(${pane.id})`);
  }

  return parts.join(" ") || pane.id || "unknown pane";
}
