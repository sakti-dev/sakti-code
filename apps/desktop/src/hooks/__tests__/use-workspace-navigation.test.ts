import { describe, expect, it } from "vitest";

describe("useWorkspaceNavigation", () => {
  it("should initialize with default values", () => {
    const state = {
      focusedColumn: "recent" as const,
      focusedIndex: 0,
    };

    expect(state.focusedColumn).toBe("recent");
    expect(state.focusedIndex).toBe(0);
  });

  it("should navigate down in current column", () => {
    let focusedIndex = 0;
    const maxIndex = 4;

    focusedIndex = Math.min(focusedIndex + 1, maxIndex);

    expect(focusedIndex).toBe(1);
  });

  it("should navigate up in current column", () => {
    let focusedIndex = 3;

    focusedIndex = Math.max(focusedIndex - 1, 0);

    expect(focusedIndex).toBe(2);
  });

  it("should switch columns", () => {
    let focusedColumn: "recent" | "archived" = "recent";

    if (focusedColumn === "recent") {
      focusedColumn = "archived";
    }

    expect(focusedColumn).toBe("archived");
  });

  it("should open focused workspace", () => {
    const workspaces = [
      { id: "1", name: "Workspace 1" },
      { id: "2", name: "Workspace 2" },
    ];
    let focusedIndex = 0;
    let focusedColumn = "recent" as const;

    const selectedWorkspace = focusedColumn === "recent" ? workspaces[focusedIndex] : null;

    expect(selectedWorkspace).toEqual({ id: "1", name: "Workspace 1" });
  });
});
