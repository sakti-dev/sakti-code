import { describe, expect, it } from "vite-plus/test";
import {
  BUILTIN_SKILL_NAMES,
  getBuiltinSkillForPhase,
  isBuiltinSkillName,
} from "../phase-skills.ts";

describe("getBuiltinSkillForPhase", () => {
  it("maps plan phase to sakti-plan skill", () => {
    expect(getBuiltinSkillForPhase("plan")).toBe("sakti-plan");
  });

  it("maps specify phase to sakti-specify skill", () => {
    expect(getBuiltinSkillForPhase("specify")).toBe("sakti-specify");
  });

  it("maps build phase to sakti-build skill", () => {
    expect(getBuiltinSkillForPhase("build")).toBe("sakti-build");
  });

  it("maps verify phase to sakti-verify skill", () => {
    expect(getBuiltinSkillForPhase("verify")).toBe("sakti-verify");
  });

  it("maps archive phase to sakti-archive skill", () => {
    expect(getBuiltinSkillForPhase("archive")).toBe("sakti-archive");
  });

  it("returns undefined for unknown phases", () => {
    expect(getBuiltinSkillForPhase("unknown")).toBeUndefined();
    expect(getBuiltinSkillForPhase("")).toBeUndefined();
  });
});

describe("isBuiltinSkillName", () => {
  it("returns true for the 5 phase skills", () => {
    expect(isBuiltinSkillName("sakti-plan")).toBe(true);
    expect(isBuiltinSkillName("sakti-specify")).toBe(true);
    expect(isBuiltinSkillName("sakti-build")).toBe(true);
    expect(isBuiltinSkillName("sakti-verify")).toBe(true);
    expect(isBuiltinSkillName("sakti-archive")).toBe(true);
  });

  it("returns false for user-defined skills", () => {
    expect(isBuiltinSkillName("my-custom-skill")).toBe(false);
    expect(isBuiltinSkillName("debugging")).toBe(false);
  });
});

describe("BUILTIN_SKILL_NAMES", () => {
  it("is exactly the 5 phase skills", () => {
    expect(BUILTIN_SKILL_NAMES).toEqual([
      "sakti-plan",
      "sakti-specify",
      "sakti-build",
      "sakti-verify",
      "sakti-archive",
    ]);
  });
});
