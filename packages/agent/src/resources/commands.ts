import { Effect } from "effect";
import { configEntryNameFromPath } from "../agents/config-entry-name";
import { type LoaderDiagnostic, parseFrontmatter, resolveKind } from "../agents/loader-shared";
import type { ExecutionEnv, PromptTemplate } from "../harness-types";
import { isFailure } from "../harness-types";

export type CommandDiagnosticCode =
  | "file_info_failed"
  | "list_failed"
  | "read_failed"
  | "parse_failed";

/** Warning produced while loading commands. */
export interface CommandDiagnostic extends LoaderDiagnostic {
  code: CommandDiagnosticCode;
}

interface CommandFrontmatter {
  description?: string;
  [key: string]: unknown;
}

const COMMAND_PREFIXES = ["command/", "commands/"];

/**
 * Load slash commands from one or more config directories.
 *
 * Each config directory is scanned for `command/` and/or `commands/` subtrees
 * (both singular and plural are accepted, matching opencode). Every `.md` file
 * within those subtrees becomes a {@link PromptTemplate}: YAML frontmatter
 * supplies `description`, the markdown body becomes `content`, and the entry
 * name (the `/name` trigger) is derived from the path relative to the config
 * directory with the `command/`/`commands/` prefix and extension stripped.
 *
 * Ignore files are deliberately not honored — commands the user creates should
 * always load. Missing config directories and missing command subtrees are
 * skipped silently. Read/parse failures are returned as diagnostics, not thrown.
 */
export async function loadCommands(
  env: ExecutionEnv,
  dirs: string | string[],
): Promise<{ commands: PromptTemplate[]; diagnostics: CommandDiagnostic[] }> {
  const commands: PromptTemplate[] = [];
  const diagnostics: CommandDiagnostic[] = [];
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
    const entriesResult = await env.listDir(rootInfo.path);
    if (isFailure(entriesResult)) {
      diagnostics.push({
        type: "warning",
        code: "list_failed",
        message: entriesResult.failure.message,
        path: rootInfo.path,
      });
      continue;
    }
    for (const entry of entriesResult.success.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name !== "command" && entry.name !== "commands") {
        continue;
      }
      const kind = await resolveKind(env, entry, diagnostics);
      if (kind !== "directory") {
        continue;
      }
      await collectCommands(env, entry.path, entry.name, commands, diagnostics);
    }
  }
  commands.sort((a, b) => a.name.localeCompare(b.name));
  return { commands, diagnostics };
}

async function collectCommands(
  env: ExecutionEnv,
  dir: string,
  relFromConfig: string,
  commands: PromptTemplate[],
  diagnostics: CommandDiagnostic[],
): Promise<void> {
  const entriesResult = await env.listDir(dir);
  if (isFailure(entriesResult)) {
    diagnostics.push({
      type: "warning",
      code: "list_failed",
      message: entriesResult.failure.message,
      path: dir,
    });
    return;
  }
  for (const entry of entriesResult.success.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = `${relFromConfig}/${entry.name}`;
    const kind = await resolveKind(env, entry, diagnostics);
    if (kind === "directory") {
      await collectCommands(env, entry.path, childRel, commands, diagnostics);
      continue;
    }
    if (kind !== "file" || !entry.name.endsWith(".md")) {
      continue;
    }
    const result = await loadCommandFromFile(env, entry.path);
    if (result.command) {
      const named = configEntryNameFromPath(childRel, COMMAND_PREFIXES);
      commands.push({ name: named, ...result.command });
    }
    diagnostics.push(...result.diagnostics);
  }
}

async function loadCommandFromFile(
  env: ExecutionEnv,
  filePath: string,
): Promise<{
  command: Omit<PromptTemplate, "name"> | null;
  diagnostics: CommandDiagnostic[];
}> {
  const diagnostics: CommandDiagnostic[] = [];
  const rawContent = await env.readTextFile(filePath);
  if (isFailure(rawContent)) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: rawContent.failure.message,
      path: filePath,
    });
    return { command: null, diagnostics };
  }

  const parsed = parseFrontmatter<CommandFrontmatter>(rawContent.success);
  if (isFailure(parsed)) {
    diagnostics.push({
      type: "warning",
      code: "parse_failed",
      message: parsed.failure.message,
      path: filePath,
    });
    return { command: null, diagnostics };
  }

  const { frontmatter, body } = parsed.success;
  const description =
    typeof frontmatter.description === "string" ? frontmatter.description : undefined;

  return {
    command: {
      ...(description === undefined ? {} : { description }),
      content: body,
    },
    diagnostics,
  };
}

/** Effect-native variant of {@link loadCommands}. */
export const loadCommandsEffect = (
  env: ExecutionEnv,
  dirs: string | string[],
): Effect.Effect<{
  commands: PromptTemplate[];
  diagnostics: CommandDiagnostic[];
}> => Effect.promise(() => loadCommands(env, dirs));
