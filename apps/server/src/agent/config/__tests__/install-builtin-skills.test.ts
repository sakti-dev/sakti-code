import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { BUILTIN_SKILL_NAMES, installBuiltinSkills } from "../install-builtin-skills.ts";

describe("installBuiltinSkills", () => {
  let runtimeDir: string;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "sakti-skills-test-"));
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("creates the runtime dir if it does not exist", async () => {
    const missing = join(runtimeDir, "nested", "skills");
    await installBuiltinSkills(missing);
    const info = await stat(missing);
    expect(info.isDirectory()).toBe(true);
  });

  it("copies all 5 builtin skills to the runtime dir", async () => {
    await installBuiltinSkills(runtimeDir);
    for (const name of BUILTIN_SKILL_NAMES) {
      const skillMd = await readFile(join(runtimeDir, name, "SKILL.md"), "utf8");
      expect(skillMd).toContain("---");
      expect(skillMd).toContain(`name: ${name}`);
    }
  });

  it("copies reference subdirectories", async () => {
    await installBuiltinSkills(runtimeDir);
    const ref = await readFile(
      join(runtimeDir, "sakti-build", "references", "execution-guide.md"),
      "utf8",
    );
    expect(ref.length).toBeGreaterThan(0);
  });

  it("overwrites existing files (idempotent)", async () => {
    await installBuiltinSkills(runtimeDir);
    const target = join(runtimeDir, "sakti-plan", "SKILL.md");
    await writeFile(target, "CORRUPTED");
    await installBuiltinSkills(runtimeDir);
    const content = await readFile(target, "utf8");
    expect(content).not.toBe("CORRUPTED");
    expect(content).toContain("name: sakti-plan");
  });
});
