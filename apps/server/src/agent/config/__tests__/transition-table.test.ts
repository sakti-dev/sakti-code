import { describe, expect, it } from "vite-plus/test";
import { allEdges, getEdge, hasEdge, phaseFromSession } from "../transition-table.ts";

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

  it("every edge declares the status it flips the session to (or graduation)", () => {
    const planMission = getEdge("plan", "mission");
    expect(planMission.requiresGraduation).toBe(true);
    expect(getEdge("specify", "build").statusTarget).toBe("building");
    expect(getEdge("build", "verify").statusTarget).toBe("review");
    expect(getEdge("verify", "build").statusTarget).toBe("building");
    expect(getEdge("verify", "archive").statusTarget).toBe("merged");
  });
});

describe("phaseFromSession", () => {
  it("maps a plan session to the plan phase", () => {
    expect(phaseFromSession({ kind: "plan", status: "specifying" })).toBe("plan");
  });

  it("maps mission statuses to phases", () => {
    expect(phaseFromSession({ kind: "mission", status: "specifying" })).toBe("specify");
    expect(phaseFromSession({ kind: "mission", status: "building" })).toBe("build");
    expect(phaseFromSession({ kind: "mission", status: "review" })).toBe("verify");
    expect(phaseFromSession({ kind: "mission", status: "merged" })).toBe("archive");
  });

  it("phaseFromSession throws for an unknown status on a mission", () => {
    expect(() => phaseFromSession({ kind: "mission", status: "bogus-phase" })).toThrow(
      /Unknown status/,
    );
  });
});

describe("hasEdge", () => {
  it("returns true for declared edges, false otherwise", () => {
    expect(hasEdge("build", "verify")).toBe(true);
    expect(hasEdge("verify", "archive")).toBe(true);
    expect(hasEdge("build", "archive")).toBe(false);
  });
});
