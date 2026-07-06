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

  it("maps specifying status (design phase) to sakti-design skill", () => {
    expect(getBuiltinSkillForPhase("design")).toBe("sakti-design");
    expect(getBuiltinSkillForPhase("specifying")).toBe("sakti-design");
  });

  it("maps building status to sakti-build skill", () => {
    expect(getBuiltinSkillForPhase("build")).toBe("sakti-build");
    expect(getBuiltinSkillForPhase("building")).toBe("sakti-build");
  });

  it("maps review status (verify phase) to sakti-verify skill", () => {
    expect(getBuiltinSkillForPhase("verify")).toBe("sakti-verify");
    expect(getBuiltinSkillForPhase("review")).toBe("sakti-verify");
  });

  it("maps merged status (archive phase) to sakti-archive skill", () => {
    expect(getBuiltinSkillForPhase("archive")).toBe("sakti-archive");
    expect(getBuiltinSkillForPhase("merged")).toBe("sakti-archive");
  });

  it("returns undefined for unknown phases", () => {
    expect(getBuiltinSkillForPhase("unknown")).toBeUndefined();
    expect(getBuiltinSkillForPhase("")).toBeUndefined();
  });
});

describe("isBuiltinSkillName", () => {
  it("returns true for the 5 phase skills", () => {
    expect(isBuiltinSkillName("sakti-plan")).toBe(true);
    expect(isBuiltinSkillName("sakti-design")).toBe(true);
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
      "sakti-design",
      "sakti-build",
      "sakti-verify",
      "sakti-archive",
    ]);
  });
});
