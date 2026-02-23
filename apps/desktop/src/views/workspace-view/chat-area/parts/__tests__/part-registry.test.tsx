import {
  clearPartRegistry,
  getPartComponent,
  hasPartComponent,
  registerPartComponent,
} from "@/views/workspace-view/chat-area/parts/part-registry";
import { beforeEach, describe, expect, it } from "vitest";

describe("PartRegistry", () => {
  beforeEach(() => {
    clearPartRegistry();
  });

  it("registers a component for a part type", () => {
    const MockComponent = () => <div>Mock</div>;
    registerPartComponent("text", MockComponent);

    expect(getPartComponent("text")).toBe(MockComponent);
  });

  it("retrieves a registered component by type", () => {
    const MockComponent = () => <div>Mock</div>;
    registerPartComponent("tool", MockComponent);

    expect(getPartComponent("tool")).toBe(MockComponent);
  });

  it("returns undefined for unregistered types", () => {
    expect(getPartComponent("unknown")).toBeUndefined();
  });

  it("reports if a part type is registered", () => {
    const MockComponent = () => <div>Mock</div>;
    registerPartComponent("reasoning", MockComponent);

    expect(hasPartComponent("reasoning")).toBe(true);
    expect(hasPartComponent("unknown")).toBe(false);
  });

  it("overwrites previous registration for same type", () => {
    const FirstComponent = () => <div>First</div>;
    const SecondComponent = () => <div>Second</div>;

    registerPartComponent("text", FirstComponent);
    registerPartComponent("text", SecondComponent);

    expect(getPartComponent("text")).toBe(SecondComponent);
  });

  it("clears all registered components", () => {
    const MockComponent = () => <div>Mock</div>;
    registerPartComponent("text", MockComponent);
    registerPartComponent("tool", MockComponent);

    clearPartRegistry();

    expect(hasPartComponent("text")).toBe(false);
    expect(hasPartComponent("tool")).toBe(false);
  });
});
