import { describe, expect, it } from "vite-plus/test";
import { rgBinPath } from "../tool-registry.ts";

describe("tool-registry rg path", () => {
  it("resolves to an absolute bundled rg binary path (not a bare PATH lookup)", () => {
    const p = rgBinPath();
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
    // @vscode/ripgrep exposes rgPath as an absolute path; ensure it's not just "rg"
    expect(p).not.toBe("rg");
  });
});
