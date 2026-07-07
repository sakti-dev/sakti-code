import { describe, expect, it } from "vite-plus/test";
import type { ObservationEntry, ReflectionEntry, SessionTreeEntry } from "../entries";

describe("ObservationEntry / ReflectionEntry", () => {
  it("ObservationEntry has type 'observation' with summary content", () => {
    const e: ObservationEntry = {
      id: "e1",
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "observation",
      summary: "* User prefers TypeScript",
      observationRecordId: "om-1",
    };
    expect(e.type).toBe("observation");
    expect(e.summary).toContain("TypeScript");
  });

  it("ReflectionEntry has type 'reflection' with summary content", () => {
    const e: ReflectionEntry = {
      id: "e2",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      type: "reflection",
      summary: "User is building a SolidJS port of fumadocs.",
      observationRecordId: "om-1",
    };
    expect(e.type).toBe("reflection");
  });

  it("both are members of the SessionTreeEntry union", () => {
    const obs: SessionTreeEntry = {
      id: "e1",
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "observation",
      summary: "x",
      observationRecordId: "om-1",
    };
    const ref: SessionTreeEntry = {
      id: "e2",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      type: "reflection",
      summary: "y",
      observationRecordId: "om-1",
    };
    expect(obs.type).toBe("observation");
    expect(ref.type).toBe("reflection");
  });
});
