import type { AgentMessage } from "../../types";
import { describe, expect, it } from "vite-plus/test";
import { convertToLlm, createObservationMessage, createReflectionMessage } from "../messages";

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

describe("convertToLlm for observation/reflection", () => {
  it("renders observation as user-role with <observation> XML wrapping", () => {
    const msgs: AgentMessage[] = [
      { role: "observation", summary: "* User likes TS", timestamp: 1 },
    ];
    const out = convertToLlm(msgs);
    expect(out[0]!.role).toBe("user");
    const text = (out[0]!.content[0] as { text: string }).text;
    expect(text).toContain("<observation>");
    expect(text).toContain("User likes TS");
    expect(text).toContain("</observation>");
  });

  it("renders reflection as user-role with <reflection> XML wrapping", () => {
    const msgs: AgentMessage[] = [{ role: "reflection", summary: "condensed", timestamp: 1 }];
    const out = convertToLlm(msgs);
    expect(out[0]!.role).toBe("user");
    const text = (out[0]!.content[0] as { text: string }).text;
    expect(text).toContain("<reflection>");
    expect(text).toContain("condensed");
  });
});
