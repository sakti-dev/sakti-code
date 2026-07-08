import { describe, expect, it } from "vite-plus/test";
import { autonomousPhaseForSession, buildReminder } from "../reminder.ts";

describe("autonomousPhaseForSession", () => {
  it("maps building → build, review → verify", () => {
    expect(autonomousPhaseForSession({ kind: "mission", status: "building" })).toBe("build");
    expect(autonomousPhaseForSession({ kind: "mission", status: "review" })).toBe("verify");
  });

  it("returns null for specify (interactive) and plan sessions", () => {
    expect(autonomousPhaseForSession({ kind: "mission", status: "specifying" })).toBeNull();
    expect(autonomousPhaseForSession({ kind: "plan", status: "specifying" })).toBeNull();
  });
});

describe("buildReminder", () => {
  it("build reminder without progress is phase-aware", () => {
    const r = buildReminder("build");
    expect(r).toContain('<reminder phase="build">');
    expect(r).toContain('transition({to:"verify"})');
  });

  it("build reminder with progress is progress-aware (counts remaining)", () => {
    const r = buildReminder("build", { total: 5, completed: 3 });
    expect(r).toContain("2 of 5 tasks still unchecked");
    expect(r).toContain('transition({to:"verify"})');
  });

  it("build reminder with all-complete does not claim unchecked tasks", () => {
    const r = buildReminder("build", { total: 4, completed: 4 });
    expect(r).not.toContain("tasks still unchecked");
  });

  it("verify reminder lists both transition options", () => {
    const r = buildReminder("verify");
    expect(r).toContain('<reminder phase="verify">');
    expect(r).toContain('transition({to:"build"})');
    expect(r).toContain('transition({to:"archive"})');
    expect(r).toContain("completeness");
  });

  it("escalation tone at the stall cap (stallCount >= 2)", () => {
    const reminder = buildReminder("build", undefined, 2);
    expect(reminder).toContain("stalled");
    expect(reminder).toContain("blocker");
  });

  it("non-escalated reminder does not contain escalation language", () => {
    const reminder = buildReminder("build", undefined, 0);
    expect(reminder).not.toContain("stalled");
  });
});
