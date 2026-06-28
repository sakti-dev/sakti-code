import { describe, expect, it } from "vitest";
import { nativeBlockResolver } from "../block-resolver";

describe("nativeBlockResolver", () => {
  const TS = "function f() {\n  return 1\n}\n";

  it("resolves a real TS function block beginning on line 1", () => {
    expect(nativeBlockResolver({ path: "f.ts", text: TS, line: 1 })).toEqual({
      start: 1,
      end: 3,
    });
  });

  it("returns null for a lone closing brace (line 4)", () => {
    expect(nativeBlockResolver({ path: "f.ts", text: TS, line: 4 })).toBeNull();
  });

  it("returns a stable result across repeated calls (memo cache)", () => {
    const a = nativeBlockResolver({ path: "f.ts", text: TS, line: 1 });
    const b = nativeBlockResolver({ path: "f.ts", text: TS, line: 1 });
    expect(a).toEqual(b);
    expect(a).toEqual({ start: 1, end: 3 });
  });

  it("resolves the inner if-block beginning on line 2", () => {
    const text = "function x() {\n  if (y) {\n  }\n}\n";
    expect(nativeBlockResolver({ path: "x.ts", text, line: 2 })).toEqual({
      start: 2,
      end: 3,
    });
  });

  it("returns null for an unrecognized extension", () => {
    expect(
      nativeBlockResolver({
        path: "x.unknownext",
        text: "function x() {}",
        line: 1,
      })
    ).toBeNull();
  });
});
