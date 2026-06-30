import { describe, expect, it } from "vite-plus/test";
import { SessionRegistry } from "../session-registry.ts";

describe("SessionRegistry", () => {
  it("creates store lazily on first access", () => {
    const registry = new SessionRegistry();
    expect(registry.has("s1")).toBe(false);
    const store1 = registry.get("s1");
    expect(registry.has("s1")).toBe(true);

    const store2 = registry.get("s1");
    expect(store2).toBe(store1);
  });

  it("disposes store and allows re-creation", () => {
    const registry = new SessionRegistry();
    const store1 = registry.get("s2");
    registry.dispose("s2");
    expect(registry.has("s2")).toBe(false);

    const store2 = registry.get("s2");
    expect(store2).not.toBe(store1);
  });

  it("dispose non-existent session does not throw", () => {
    const registry = new SessionRegistry();
    expect(() => registry.dispose("nonexistent")).not.toThrow();
  });

  it("supports multiple coexisting sessions", () => {
    const registry = new SessionRegistry();
    const s1 = registry.get("s1");
    const s2 = registry.get("s2");
    expect(s1).not.toBe(s2);
    expect(registry.has("s1")).toBe(true);
    expect(registry.has("s2")).toBe(true);
  });

  it("disposeAll clears all sessions", () => {
    const registry = new SessionRegistry();
    registry.get("s1");
    registry.get("s2");
    registry.disposeAll();
    expect(registry.has("s1")).toBe(false);
    expect(registry.has("s2")).toBe(false);
  });
});
