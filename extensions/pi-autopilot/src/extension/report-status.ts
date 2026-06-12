import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getRun } from "./runtime";
import type { ReportedStatus } from "./types";

export const REPORT_STATUS_TOOL = "report_status";

/**
 * Appended to the system prompt while a run is armed (layer 1 of
 * done-vs-question detection). The summary doubles as commit/PR material in
 * the ship gate.
 */
export function autopilotPromptFragment(extraInstructions?: string): string {
  const extra = extraInstructions
    ? `\n\nOperator instructions for this run:\n${extraInstructions}`
    : "";
  return (
    [
      "",
      "## Autopilot",
      "",
      "This session is running under pi-autopilot. When you finish working, call the",
      `\`${REPORT_STATUS_TOOL}\` tool as your FINAL action:`,
      '- status "complete" when the task is done and the tree is ready to verify/commit.',
      '- status "need_input" when you have a question only the operator can answer.',
      '- status "blocked" when you cannot proceed (missing access, broken environment, contradictory requirements).',
      "The summary should be commit-message quality: first line is a conventional-commit",
      "style title, then a short body describing what changed and why.",
      "Do not commit, push, or open PRs yourself — autopilot owns shipping.",
    ].join("\n") + extra
  );
}

export function registerReportStatusTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: REPORT_STATUS_TOOL,
    label: "Report status",
    description:
      "Report the final status of the current task to the autopilot loop. " +
      "Call this exactly once, as your final action, every time you stop working.",
    parameters: Type.Object({
      status: Type.Union(
        [Type.Literal("complete"), Type.Literal("need_input"), Type.Literal("blocked")],
        {
          description:
            "complete = ready to verify/ship; need_input = question for the operator; blocked = cannot proceed",
        },
      ),
      summary: Type.String({
        description:
          "For complete: commit-message quality summary of the work. For need_input/blocked: the question or blocker, stated plainly.",
      }),
    }),
    async execute(_toolCallId, params) {
      const run = getRun();
      if (run) {
        run.lastReport = {
          status: params.status as ReportedStatus,
          summary: params.summary,
          reportedAt: Date.now(),
        };
        run.firstSummary ??= params.status === "complete" ? params.summary : undefined;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: run ? "Status recorded by autopilot." : "Autopilot is not armed; status ignored.",
          },
        ],
        details: undefined,
      };
    },
  });
}
