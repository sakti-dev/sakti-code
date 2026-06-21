import { describe, expect, it } from "bun:test";
import { buildSessionContext, Session } from "../index.ts";

describe("agent barrel exports", () => {
  it("buildSessionContext is exported", () => {
    expect(typeof buildSessionContext).toBe("function");
  });

  it("Session is exported", () => {
    expect(typeof Session).toBe("function");
  });
});
