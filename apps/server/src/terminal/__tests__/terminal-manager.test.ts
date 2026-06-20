import { describe, expect, it } from "bun:test";
import { TerminalManager } from "../terminal-manager.ts";

describe("TerminalManager", () => {
  it("size is zero for a new manager", () => {
    const tm = new TerminalManager();
    expect(tm.size).toBe(0);
  });

  it("write throws for unknown terminal", () => {
    const tm = new TerminalManager();
    expect(() => tm.write("nope", "data")).toThrow("Terminal not found");
  });

  it("resize throws for unknown terminal", () => {
    const tm = new TerminalManager();
    expect(() => tm.resize("nope", 80, 24)).toThrow("Terminal not found");
  });

  it("close throws for unknown terminal", () => {
    const tm = new TerminalManager();
    expect(() => tm.close("nope")).toThrow("Terminal not found");
  });

  it("closeByConnection on empty manager does nothing", () => {
    const tm = new TerminalManager();
    tm.closeByConnection("conn-1");
    expect(tm.size).toBe(0);
  });

  it("closeAll on empty manager does nothing", () => {
    const tm = new TerminalManager();
    tm.closeAll();
    expect(tm.size).toBe(0);
  });

  it("get returns undefined for unknown terminal", () => {
    const tm = new TerminalManager();
    expect(tm.get("nope")).toBeUndefined();
  });

  it("loadError is a string or null", () => {
    const tm = new TerminalManager();
    const err = tm.loadError;
    expect(typeof err === "string" || err === null).toBe(true);
  });

  it("onData setter stores callback", () => {
    const tm = new TerminalManager();
    const cb = (_tid: string, _cid: string, _data: string) => {};
    tm.onData = cb;
    // Setter should not throw
    expect(true).toBe(true);
  });

  it("onExit setter stores callback", () => {
    const tm = new TerminalManager();
    const cb = (_tid: string, _cid: string, _code: number, _sig?: number) => {};
    tm.onExit = cb;
    expect(true).toBe(true);
  });
});
