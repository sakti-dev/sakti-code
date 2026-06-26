import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "../context-menu.tsx";

const commands = [{ name: "commit", description: "commit and push" }];
const skills = [{ name: "graphify", description: "build a graph" }];
const USE_AS_PATH_RE = /Use .* as a path/;

describe("ContextMenu (/ mode)", () => {
  it("renders commands and skills, and picking a command yields /name", async () => {
    const onPick = vi.fn();
    render(() => (
      <ContextMenu
        commands={commands}
        files={[]}
        mode="/"
        onClose={vi.fn()}
        onPick={onPick}
        open
        skills={skills}
      />
    ));
    await waitFor(() => {
      expect(screen.getByText("commit")).toBeTruthy();
      expect(screen.getByText("graphify")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("commit"));
    expect(onPick).toHaveBeenCalledWith("/commit");
  });

  it("picking a skill yields skill:name", async () => {
    const onPick = vi.fn();
    render(() => (
      <ContextMenu
        commands={commands}
        files={[]}
        mode="/"
        onClose={vi.fn()}
        onPick={onPick}
        open
        skills={skills}
      />
    ));
    await waitFor(() => {
      expect(screen.getByText("graphify")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("graphify"));
    expect(onPick).toHaveBeenCalledWith("skill:graphify");
  });

  it("filters commands+skills by the query", async () => {
    render(() => (
      <ContextMenu
        commands={commands}
        files={[]}
        mode="/"
        onClose={vi.fn()}
        onPick={vi.fn()}
        open
        skills={skills}
      />
    ));
    await waitFor(() => {
      expect(screen.getByText("commit")).toBeTruthy();
    });
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "graph" } });
    await waitFor(() => {
      expect(screen.queryByText("commit")).toBeNull();
      expect(screen.getByText("graphify")).toBeTruthy();
    });
  });
});

describe("ContextMenu (@ mode)", () => {
  it("renders files and picking yields @path", async () => {
    const onPick = vi.fn();
    render(() => (
      <ContextMenu
        commands={[]}
        files={[{ path: "src/a.ts" }]}
        mode="@"
        onClose={vi.fn()}
        onPick={onPick}
        open
        skills={[]}
      />
    ));
    await waitFor(() => {
      expect(screen.getByText("src/a.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("src/a.ts"));
    expect(onPick).toHaveBeenCalledWith("@src/a.ts");
  });

  it("shows an 'insert as path' row when no files match and yields @<query>", async () => {
    const onPick = vi.fn();
    render(() => (
      <ContextMenu
        commands={[]}
        files={[]}
        mode="@"
        onClose={vi.fn()}
        onPick={onPick}
        open
        skills={[]}
      />
    ));
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "deep/miss.ts" } });
    await waitFor(() => {
      expect(screen.getByText(USE_AS_PATH_RE)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(USE_AS_PATH_RE));
    expect(onPick).toHaveBeenCalledWith("@deep/miss.ts");
  });

  it("notifies the parent of the files query", async () => {
    const onFilesQuery = vi.fn();
    render(() => (
      <ContextMenu
        commands={[]}
        files={[]}
        mode="@"
        onClose={vi.fn()}
        onFilesQuery={onFilesQuery}
        onPick={vi.fn()}
        open
        skills={[]}
      />
    ));
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "foo" } });
    expect(onFilesQuery).toHaveBeenCalledWith("foo");
  });
});
