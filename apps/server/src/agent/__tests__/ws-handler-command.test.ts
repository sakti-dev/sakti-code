import { Value } from "typebox/value";
import { describe, expect, it } from "vite-plus/test";
import { wsBodySchema } from "../ws-handler.ts";

describe("wsBodySchema command variant", () => {
  it("accepts a compact command", () => {
    const msg = { type: "command", sessionId: "s1", name: "compact" };
    expect(Value.Check(wsBodySchema, msg)).toBe(true);
  });

  it("accepts compact with customInstructions", () => {
    const msg = {
      type: "command",
      sessionId: "s1",
      name: "compact",
      customInstructions: "focus on API changes",
    };
    expect(Value.Check(wsBodySchema, msg)).toBe(true);
  });

  it("rejects command without sessionId", () => {
    const msg = { type: "command", name: "compact" };
    expect(Value.Check(wsBodySchema, msg)).toBe(false);
  });

  it("rejects command without name", () => {
    const msg = { type: "command", sessionId: "s1" };
    expect(Value.Check(wsBodySchema, msg)).toBe(false);
  });

  it("rejects command with unknown name", () => {
    const msg = { type: "command", sessionId: "s1", name: "fly" };
    expect(Value.Check(wsBodySchema, msg)).toBe(false);
  });
});
