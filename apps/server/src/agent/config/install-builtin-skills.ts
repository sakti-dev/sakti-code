import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "../../lib/config-dirs.ts";
import { BUILTIN_SKILL_NAMES } from "./phase-skills.ts";

/**
 * Re-exported so tests and future callers have a single import surface for
 * "what builtin skills exist" alongside the install function.
 */
export { BUILTIN_SKILL_NAMES } from "./phase-skills.ts";
export type { BuiltinSkillName } from "./phase-skills.ts";

/**
 * Absolute path to the builtin skills source directory (co-located with this
 * module). Derived from `import.meta.url` — the module's own filesystem
 * location — so it is stable across env overrides and safe as a constant.
 */
export const BUILTIN_SKILLS_SOURCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "builtin-skills",
);

/**
 * Runtime dir where `loadAgentContext` scans for skills (`<agentDir>/skills`).
 * Reads `SAKTI_AGENT_DIR` live via {@link getAgentDir} so env overrides (e.g.
 * in tests or when the desktop shell redirects state) take effect at call
 * time, matching the pattern of `getDbPath` / `getAuthPath` / etc. Part 4 will
 * call this to compute the OM observer's `skillFilterRoot`.
 */
export function getBuiltinSkillsRuntimeDir(): string {
  return join(getAgentDir(), "skills");
}

/**
 * Install (sync) builtin skills from source to the runtime dir.
 *
 * Runtime dir defaults to {@link getBuiltinSkillsRuntimeDir}
 * (`~/.sakti/agent/skills/`) — where `loadAgentContext` scans. Always
 * overwrites: skills are small markdown trees, source is canonical, idempotent
 * re-runs are safe.
 *
 * Called at server bootstrap (see `createServer`), before any `loadAgentContext`
 * invocation.
 */
export async function installBuiltinSkills(
  runtimeDir: string = getBuiltinSkillsRuntimeDir(),
): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  for (const name of BUILTIN_SKILL_NAMES) {
    const src = join(BUILTIN_SKILLS_SOURCE_DIR, name);
    const dest = join(runtimeDir, name);
    await cp(src, dest, { recursive: true, force: true });
  }
}
