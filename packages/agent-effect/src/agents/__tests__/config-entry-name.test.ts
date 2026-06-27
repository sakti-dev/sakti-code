import { describe, expect, it } from "vitest";
import { configEntryNameFromPath } from "~/agents/config-entry-name";

describe("configEntryNameFromPath", () => {
  it("strips command/ prefix and extension", () => {
    expect(
      configEntryNameFromPath("command/commit.md", ["command/", "commands/"])
    ).toBe("commit");
  });

  it("strips plural commands/ prefix", () => {
    expect(
      configEntryNameFromPath("commands/foo/bar.md", ["command/", "commands/"])
    ).toBe("foo/bar");
  });

  it("strips agent/ and agents/ prefixes", () => {
    expect(
      configEntryNameFromPath("agent/triage.md", ["agent/", "agents/"])
    ).toBe("triage");
    expect(
      configEntryNameFromPath("agents/team/triage.md", ["agent/", "agents/"])
    ).toBe("team/triage");
  });

  it("falls back to basename when no prefix matches", () => {
    expect(
      configEntryNameFromPath("triage.md", ["command/", "commands/"])
    ).toBe("triage");
  });

  it("handles paths with no extension", () => {
    expect(
      configEntryNameFromPath("command/README", ["command/", "commands/"])
    ).toBe("README");
  });

  it("normalizes backslashes to forward slashes before stripping", () => {
    expect(
      configEntryNameFromPath("command\\sub\\x.md", ["command/", "commands/"])
    ).toBe("sub/x");
  });
});
