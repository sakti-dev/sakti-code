import { describe, expect, it } from "vite-plus/test";
import { createObservationMessage, createReflectionMessage } from "../messages";

describe("createObservationMessage / createReflectionMessage", () => {
  it("createObservationMessage returns role 'observation' with summary + timestamp", () => {
    const msg = createObservationMessage(
      "* User likes TS",
      new Date("2026-07-07T00:00:00Z").toISOString(),
    );
    expect(msg.role).toBe("observation");
    expect(msg.summary).toBe("* User likes TS");
    expect(msg.timestamp).toBe(Date.parse("2026-07-07T00:00:00Z"));
  });

  it("createReflectionMessage returns role 'reflection' with summary + timestamp", () => {
    const msg = createReflectionMessage(
      "condensed memory",
      new Date("2026-07-07T00:00:00Z").toISOString(),
    );
    expect(msg.role).toBe("reflection");
    expect(msg.summary).toBe("condensed memory");
  });
});
