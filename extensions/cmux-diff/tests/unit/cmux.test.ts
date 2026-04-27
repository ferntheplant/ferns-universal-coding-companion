import { describe, expect, test } from "bun:test";
import { buildCmuxOpenCommand, buildPaneLabel, type PaneInfo } from "../../src/domain/cmux";

describe("cmux command builder", () => {
  test("builds new-pane browser command", () => {
    const cmd = buildCmuxOpenCommand({
      url: "http://127.0.0.1:1234/review/token",
      mode: "new-pane",
    });

    expect(cmd.command).toBe("cmux");
    expect(cmd.args).toEqual([
      "new-pane",
      "--type",
      "browser",
      "--url",
      "http://127.0.0.1:1234/review/token",
    ]);
  });

  test("builds existing-pane browser command", () => {
    const cmd = buildCmuxOpenCommand({
      url: "http://127.0.0.1:1234/review/token",
      mode: "existing-pane",
      paneId: "pane-123",
    });

    expect(cmd.command).toBe("cmux");
    expect(cmd.args).toEqual([
      "new-surface",
      "--type",
      "browser",
      "--pane",
      "pane-123",
      "--url",
      "http://127.0.0.1:1234/review/token",
    ]);
  });

  test("throws error for existing-pane without paneId", () => {
    expect(() => {
      buildCmuxOpenCommand({
        url: "http://127.0.0.1:1234/review/token",
        mode: "existing-pane",
        // paneId is missing
      });
    }).toThrow("paneId is required when mode is 'existing-pane'");
  });
});

describe("buildPaneLabel", () => {
  test("builds label with title and id", () => {
    const label = buildPaneLabel({
      id: "pane:1",
      title: "My Terminal",
      type: "terminal",
    });
    expect(label).toBe("My Terminal (pane:1)");
  });

  test("builds label with type when title is missing", () => {
    const label = buildPaneLabel({
      id: "pane:2",
      type: "browser",
    });
    expect(label).toBe("browser (pane:2)");
  });

  test("builds label with just id when title and type are missing", () => {
    const label = buildPaneLabel({
      id: "pane:3",
    });
    expect(label).toBe("(pane:3)");
  });

  test("returns unknown pane for empty pane info", () => {
    const label = buildPaneLabel({});
    expect(label).toBe("unknown pane");
  });

  test("adds star for focused pane", () => {
    const label = buildPaneLabel({
      id: "pane:1",
      title: "Current Pane",
      isFocused: true,
    });
    expect(label).toBe("★ Current Pane (pane:1)");
  });

  test("handles pane with only type and focused state", () => {
    const label = buildPaneLabel({
      id: "pane:4",
      type: "editor",
      isFocused: true,
    });
    expect(label).toBe("★ editor (pane:4)");
  });
});
