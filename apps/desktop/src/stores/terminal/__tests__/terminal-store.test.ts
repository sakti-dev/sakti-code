import { describe, expect, it } from "vite-plus/test";
import { createTerminalStore } from "../terminal-store.ts";

describe("terminal store", () => {
  it("appendData accumulates buffer", () => {
    const term = createTerminalStore();
    expect(term.buffer).toBe("");

    term.appendData("hello ");
    term.appendData("world");
    expect(term.buffer).toBe("hello world");
  });

  it("appendData updates bufferLength reactively", () => {
    const term = createTerminalStore();
    expect(term.store.bufferLength).toBe(0);

    term.appendData("hello");
    expect(term.store.bufferLength).toBe(5);

    term.appendData(" world");
    expect(term.store.bufferLength).toBe(11);
  });

  it("setExit marks the terminal as exited", () => {
    const term = createTerminalStore();
    expect(term.store.exitCode).toBeNull();

    term.setExit(0);
    expect(term.store.exitCode).toBe(0);
  });

  it("setExit with non-zero code", () => {
    const term = createTerminalStore();
    term.setExit(130);
    expect(term.store.exitCode).toBe(130);
  });

  it("resize updates cols and rows", () => {
    const term = createTerminalStore();
    expect(term.store.cols).toBe(80);
    expect(term.store.rows).toBe(24);

    term.resize(120, 40);
    expect(term.store.cols).toBe(120);
    expect(term.store.rows).toBe(40);
  });

  it("reset clears buffer and exitCode", () => {
    const term = createTerminalStore();
    term.appendData("some data");
    term.setExit(1);

    term.reset();

    expect(term.buffer).toBe("");
    expect(term.store.exitCode).toBeNull();
    expect(term.store.bufferLength).toBe(0);
  });

  it("caps buffer at MAX_BUFFER_CHARS", () => {
    const term = createTerminalStore();
    const chunk = "x".repeat(600_000);
    term.appendData(chunk);
    expect(term.buffer.length).toBeLessThan(600_001);
    expect(term.store.bufferLength).toBe(term.buffer.length);
  });
});
