import { describe, expect, it } from "vitest";
import {
  disposeSessionStore,
  getSessionStore,
  hasSessionStore,
} from "../session-registry.ts";

describe("session registry", () => {
  it("creates store lazily on first access", () => {
    expect(hasSessionStore("s1")).toBe(false);
    const store1 = getSessionStore("s1");
    expect(hasSessionStore("s1")).toBe(true);

    const store2 = getSessionStore("s1");
    expect(store2).toBe(store1);

    disposeSessionStore("s1");
  });

  it("disposes store and allows re-creation", () => {
    const store1 = getSessionStore("s2");
    disposeSessionStore("s2");
    expect(hasSessionStore("s2")).toBe(false);

    const store2 = getSessionStore("s2");
    expect(store2).not.toBe(store1);

    disposeSessionStore("s2");
  });
});
