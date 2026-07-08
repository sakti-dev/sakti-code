/**
 * Builtin SDD phase skills — the closed set shipped with the app. These are
 * non-removable and receive special handling: forced skill injection at run
 * start (ephemeral synthetic tool-result) and observer filtering (excluded
 * from OM observe input so they don't pollute observations).
 *
 * Adding a 6th builtin here automatically opts it into install-at-boot sync
 * (see {@link installBuiltinSkills}) and injection + filtering.
 */
export const BUILTIN_SKILL_NAMES = [
  "sakti-plan",
  "sakti-specify",
  "sakti-build",
  "sakti-verify",
  "sakti-archive",
] as const;

export type BuiltinSkillName = (typeof BUILTIN_SKILL_NAMES)[number];

const BUILTIN_SKILL_SET: ReadonlySet<string> = new Set(BUILTIN_SKILL_NAMES);

export function isBuiltinSkillName(name: string): boolean {
  return BUILTIN_SKILL_SET.has(name);
}

/**
 * Map a session phase (which now equals the DB `status` column after the
 * status rename) to the builtin skill that should be force-injected at run
 * start. Returns `undefined` when no skill applies (unknown phase).
 */
const PHASE_TO_SKILL: Readonly<Record<string, BuiltinSkillName>> = {
  plan: "sakti-plan",
  specify: "sakti-specify",
  build: "sakti-build",
  verify: "sakti-verify",
  archive: "sakti-archive",
};

export function getBuiltinSkillForPhase(phase: string): BuiltinSkillName | undefined {
  return PHASE_TO_SKILL[phase];
}
