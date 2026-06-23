import { describe, expect, it } from "vitest";
import { TerminalRegistry } from "../terminal-registry.ts";

describe("TerminalRegistry", () => {
  it("creates store lazily on first access", () => {
    const registry = new TerminalRegistry();
    expect(registry.has("t1")).toBe(false);
    const store1 = registry.get("t1");
    expect(registry.has("t1")).toBe(true);

    const store2 = registry.get("t1");
    expect(store2).toBe(store1);
  });

  it("disposes store and allows re-creation", () => {
    const registry = new TerminalRegistry();
    const store1 = registry.get("t2");
    registry.dispose("t2");
    expect(registry.has("t2")).toBe(false);

    const store2 = registry.get("t2");
    expect(store2).not.toBe(store1);
  });

  it("dispose non-existent terminal does not throw", () => {
    const registry = new TerminalRegistry();
    expect(() => registry.dispose("nonexistent")).not.toThrow();
  });

  it("disposeAll clears all terminals", () => {
    const registry = new TerminalRegistry();
    registry.get("t1");
    registry.get("t2");
    registry.disposeAll();
    expect(registry.has("t1")).toBe(false);
    expect(registry.has("t2")).toBe(false);
  });
});
