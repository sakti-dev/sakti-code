import { Effect } from "effect";
import {
  basenameEnvPath,
  dirnameEnvPath,
  parseFrontmatter,
  resolveKind,
} from "./loader-shared.ts";
import type { ExecutionEnv, Skill } from "./types.ts";
import { isFailure } from "./types.ts";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export type SkillDiagnosticCode =
  | "file_info_failed"
  | "list_failed"
  | "read_failed"
  | "parse_failed"
  | "invalid_metadata";

/** Warning produced while loading skills. */
export interface SkillDiagnostic {
  /** Stable diagnostic code. */
  code: SkillDiagnosticCode;
  /** Human-readable diagnostic message. */
  message: string;
  /** Path associated with the diagnostic. */
  path: string;
  /** Diagnostic severity. Currently only warnings are emitted. */
  type: "warning";
}

interface SkillFrontmatter {
  description?: string;
  "disable-model-invocation"?: boolean;
  name?: string;
  [key: string]: unknown;
}

/** Format a skill invocation prompt, optionally appending additional user instructions. */
export function formatSkillInvocation(
  skill: Skill,
  additionalInstructions?: string
): string {
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nThis skill is already loaded in full below — do not read its file again.\nReferences are relative to ${dirnameEnvPath(skill.filePath)}.\n\n${skill.content}\n</skill>`;
  return additionalInstructions
    ? `${skillBlock}\n\n${additionalInstructions}`
    : skillBlock;
}

/**
 * Load skills from one or more directories.
 *
 * Traverses directories recursively, loads `SKILL.md` files, loads direct root `.md` files as skills,
 * and returns diagnostics for invalid skill files. Missing input directories are skipped.
 * Ignore files (`.gitignore`, `.ignore`, `.fdignore`) are deliberately not honored — skills the user
 * creates should always load, even when the containing directory is gitignored.
 */
export async function loadSkills(
  env: ExecutionEnv,
  dirs: string | string[]
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    const rootInfoResult = await env.fileInfo(dir);
    if (isFailure(rootInfoResult)) {
      if (rootInfoResult.failure.code !== "not_found") {
        diagnostics.push({
          type: "warning",
          code: "file_info_failed",
          message: rootInfoResult.failure.message,
          path: dir,
        });
      }
      continue;
    }
    const rootInfo = rootInfoResult.success;
    if ((await resolveKind(env, rootInfo, diagnostics)) !== "directory") {
      continue;
    }
    const result = await loadSkillsFromDirInternal(
      env,
      rootInfo.path,
      true,
      rootInfo.path
    );
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}

/**
 * Load skills from source-tagged directories.
 *
 * Source values are preserved exactly and attached to every loaded skill and diagnostic. The agent package does not
 * interpret source values; applications define their own provenance shape.
 */
export async function loadSourcedSkills<TSource, TSkill extends Skill = Skill>(
  env: ExecutionEnv,
  inputs: Array<{ path: string; source: TSource }>,
  mapSkill?: (skill: Skill, source: TSource) => TSkill
): Promise<{
  skills: Array<{ skill: TSkill; source: TSource }>;
  diagnostics: Array<SkillDiagnostic & { source: TSource }>;
}> {
  const skills: Array<{ skill: TSkill; source: TSource }> = [];
  const diagnostics: Array<SkillDiagnostic & { source: TSource }> = [];
  for (const input of inputs) {
    const result = await loadSkills(env, input.path);
    for (const skill of result.skills) {
      skills.push({
        skill: mapSkill ? mapSkill(skill, input.source) : (skill as TSkill),
        source: input.source,
      });
    }
    for (const diagnostic of result.diagnostics) {
      diagnostics.push({ ...diagnostic, source: input.source });
    }
  }
  return { skills, diagnostics };
}

async function loadSkillsFromDirInternal(
  env: ExecutionEnv,
  dir: string,
  includeRootFiles: boolean,
  rootDir: string
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  const dirInfoResult = await env.fileInfo(dir);
  if (isFailure(dirInfoResult)) {
    if (dirInfoResult.failure.code !== "not_found") {
      diagnostics.push({
        type: "warning",
        code: "file_info_failed",
        message: dirInfoResult.failure.message,
        path: dir,
      });
    }
    return { skills, diagnostics };
  }
  const dirInfo = dirInfoResult.success;
  if ((await resolveKind(env, dirInfo, diagnostics)) !== "directory") {
    return { skills, diagnostics };
  }

  const entriesResult = await env.listDir(dir);
  if (isFailure(entriesResult)) {
    diagnostics.push({
      type: "warning",
      code: "list_failed",
      message: entriesResult.failure.message,
      path: dir,
    });
    return { skills, diagnostics };
  }
  const entries = entriesResult.success;

  for (const entry of entries) {
    if (entry.name !== "SKILL.md") {
      continue;
    }
    const fullPath = entry.path;
    const kind = await resolveKind(env, entry, diagnostics);
    if (kind !== "file") {
      continue;
    }

    const result = await loadSkillFromFile(env, fullPath);
    if (result.skill) {
      skills.push(result.skill);
    }
    diagnostics.push(...result.diagnostics);
    return { skills, diagnostics };
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const fullPath = entry.path;
    const kind = await resolveKind(env, entry, diagnostics);
    if (!kind) {
      continue;
    }

    if (kind === "directory") {
      const result = await loadSkillsFromDirInternal(
        env,
        fullPath,
        false,
        rootDir
      );
      skills.push(...result.skills);
      diagnostics.push(...result.diagnostics);
      continue;
    }

    if (kind !== "file" || !includeRootFiles || !entry.name.endsWith(".md")) {
      continue;
    }
    const result = await loadSkillFromFile(env, fullPath);
    if (result.skill) {
      skills.push(result.skill);
    }
    diagnostics.push(...result.diagnostics);
  }

  return { skills, diagnostics };
}

async function loadSkillFromFile(
  env: ExecutionEnv,
  filePath: string
): Promise<{ skill: Skill | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = [];
  const rawContent = await env.readTextFile(filePath);
  if (isFailure(rawContent)) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: rawContent.failure.message,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const parsed = parseFrontmatter<SkillFrontmatter>(rawContent.success);
  if (isFailure(parsed)) {
    diagnostics.push({
      type: "warning",
      code: "parse_failed",
      message: parsed.failure.message,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const { frontmatter, body } = parsed.success;
  const skillDir = dirnameEnvPath(filePath);
  const parentDirName = basenameEnvPath(skillDir);
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description
      : undefined;

  for (const error of validateDescription(description)) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: error,
      path: filePath,
    });
  }

  const frontmatterName =
    typeof frontmatter.name === "string" ? frontmatter.name : undefined;
  const name = frontmatterName || parentDirName;
  for (const error of validateName(name, parentDirName)) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: error,
      path: filePath,
    });
  }

  if (!description || description.trim() === "") {
    return { skill: null, diagnostics };
  }

  return {
    skill: {
      name,
      description,
      content: body,
      filePath,
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    },
    diagnostics,
  };
}

function validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];
  if (name !== parentDirName) {
    errors.push(
      `name "${name}" does not match parent directory "${parentDirName}"`
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(
      "name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)"
    );
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push("name must not start or end with a hyphen");
  }
  if (name.includes("--")) {
    errors.push("name must not contain consecutive hyphens");
  }
  return errors;
}

function validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];
  if (!description || description.trim() === "") {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`
    );
  }
  return errors;
}

/** Effect-native variants of {@link loadSkills} and {@link loadSourcedSkills}. */
export const loadSkillsEffect = (...args: Parameters<typeof loadSkills>) =>
  Effect.promise(() => loadSkills(...args));

export const loadSourcedSkillsEffect = (
  ...args: Parameters<typeof loadSourcedSkills>
) => Effect.promise(() => loadSourcedSkills(...args));
