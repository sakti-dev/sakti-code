import { describe, expect, it } from "vite-plus/test";
import { allEdges, getEdge } from "../transition-table.ts";

describe("transition table", () => {
  it("build→verify is auto + forced observe", () => {
    const e = getEdge("build", "verify");
    expect(e.mode).toBe("auto");
    expect(e.requiresForcedObserve).toBe(true);
  });

  it("verify→build is auto", () => {
    expect(getEdge("verify", "build").mode).toBe("auto");
  });

  it("verify→archive is gate", () => {
    expect(getEdge("verify", "archive").mode).toBe("gate");
  });

  it("specify→build is gate", () => {
    expect(getEdge("specify", "build").mode).toBe("gate");
  });

  it("plan→mission is gate", () => {
    expect(getEdge("plan", "mission").mode).toBe("gate");
  });

  it("every edge carries a non-empty <instruction> template", () => {
    for (const edge of allEdges()) {
      expect(edge.instruction).toMatch(/<instruction>[\s\S]*<\/instruction>/);
      expect(edge.instruction.length).toBeGreaterThan(0);
    }
  });

  it("getEdge throws on an unknown edge", () => {
    expect(() => getEdge("build", "archive")).toThrow();
    // archive is not a valid source for any edge
    expect(() => getEdge("archive", "specify")).toThrow();
  });

  it("exposes exactly the five designed edges", () => {
    const keys = allEdges().map((e) => `${e.from}->${e.to}`);
    expect(keys.sort()).toEqual(
      [
        "plan->mission",
        "specify->build",
        "build->verify",
        "verify->build",
        "verify->archive",
      ].sort(),
    );
  });
});
