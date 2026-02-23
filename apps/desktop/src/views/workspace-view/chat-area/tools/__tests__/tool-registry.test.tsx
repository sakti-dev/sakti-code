import {
  clearToolRegistry,
  getToolRenderer,
  hasToolRenderer,
  registerToolRenderer,
  type ToolRendererProps,
} from "@/views/workspace-view/chat-area/tools/tool-registry";
import { beforeEach, describe, expect, it } from "vitest";

describe("ToolRegistry", () => {
  beforeEach(() => {
    clearToolRegistry();
  });

  it("registers a renderer for a tool name", () => {
    const MockRenderer = (_props: ToolRendererProps) => <div>Mock Tool</div>;
    registerToolRenderer("read", MockRenderer);

    expect(getToolRenderer("read")).toBe(MockRenderer);
  });

  it("retrieves a registered renderer by tool name", () => {
    const MockRenderer = (_props: ToolRendererProps) => <div>Mock Tool</div>;
    registerToolRenderer("edit", MockRenderer);

    expect(getToolRenderer("edit")).toBe(MockRenderer);
  });

  it("returns undefined for unregistered tool names", () => {
    expect(getToolRenderer("unknown")).toBeUndefined();
  });

  it("reports if a tool has a registered renderer", () => {
    const MockRenderer = (_props: ToolRendererProps) => <div>Mock Tool</div>;
    registerToolRenderer("bash", MockRenderer);

    expect(hasToolRenderer("bash")).toBe(true);
    expect(hasToolRenderer("unknown")).toBe(false);
  });

  it("overwrites previous registration for same tool", () => {
    const FirstRenderer = (_props: ToolRendererProps) => <div>First</div>;
    const SecondRenderer = (_props: ToolRendererProps) => <div>Second</div>;

    registerToolRenderer("write", FirstRenderer);
    registerToolRenderer("write", SecondRenderer);

    expect(getToolRenderer("write")).toBe(SecondRenderer);
  });

  it("clears all registered renderers", () => {
    const MockRenderer = (_props: ToolRendererProps) => <div>Mock Tool</div>;
    registerToolRenderer("read", MockRenderer);
    registerToolRenderer("write", MockRenderer);

    clearToolRegistry();

    expect(hasToolRenderer("read")).toBe(false);
    expect(hasToolRenderer("write")).toBe(false);
  });
});
