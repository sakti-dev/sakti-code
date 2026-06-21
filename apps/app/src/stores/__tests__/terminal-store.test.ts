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

  it("setExit with non-zero code", () => {
    const term = createTerminalStore("t1");
    term.setExit(130);
    expect(term.store.exitCode).toBe(130);
  });

  it("resize updates cols and rows", () => {
    const term = createTerminalStore("t1");
    expect(term.store.cols).toBe(80);
    expect(term.store.rows).toBe(24);

    term.resize(120, 40);
    expect(term.store.cols).toBe(120);
    expect(term.store.rows).toBe(40);
  });

  it("reset clears buffer and exitCode", () => {
    const term = createTerminalStore("t1");
    term.appendData("some data");
    term.setExit(1);

    term.reset();

    expect(term.store.buffer).toBe("");
    expect(term.store.exitCode).toBeNull();
  });
});
