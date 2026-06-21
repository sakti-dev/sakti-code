import { describe, expect, it } from "vitest";
import { createTerminalStore } from "../terminal-store.ts";

describe("terminal store", () => {
  it("appendData accumulates buffer", () => {
    const term = createTerminalStore("t1");
    expect(term.store.buffer).toBe("");

    term.appendData("hello ");
    term.appendData("world");
    expect(term.store.buffer).toBe("hello world");
  });

  it("setExit marks the terminal as exited", () => {
    const term = createTerminalStore("t1");
    expect(term.store.exitCode).toBeNull();

    term.setExit(0);
    expect(term.store.exitCode).toBe(0);
  });
});
