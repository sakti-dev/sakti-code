/**
 * Builtin SDD phase skills — the closed set shipped with the app. These are
 * non-removable and receive special handling: forced skill injection at run
 * start (ephemeral synthetic tool-result) and observer filtering (excluded
 * from OM observe input so they don't pollute observations).
 *
 * Part 0 of the phase-workflow plan ships just the registry; Part 3 (Task 3.1)
 * extends this file with `isBuiltinSkillName` and `getBuiltinSkillForPhase`.
 *
 * Adding a 6th builtin here automatically opts it into install-at-boot sync
 * (see {@link installBuiltinSkills}) and, once Part 3 lands, injection + filtering.
 */
export const BUILTIN_SKILL_NAMES = [
  "sakti-plan",
  "sakti-design",
  "sakti-build",
  "sakti-verify",
  "sakti-archive",
] as const;

export type BuiltinSkillName = (typeof BUILTIN_SKILL_NAMES)[number];
