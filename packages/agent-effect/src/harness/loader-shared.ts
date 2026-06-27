import { Effect } from "effect";
import { parse } from "yaml";
import {
  type ExecutionEnv,
  err,
  type FileInfo,
  isFailure,
  ok,
  type Result,
  toError,
} from "./types.ts";

/**
 * Base shape for non-fatal warnings emitted by the config/skill/prompt-template
 * loaders. Each loader narrows `code` to its own union
 * (e.g. {@link SkillDiagnostic}, `PromptTemplateDiagnostic`) and passes its
 * `Diagnostic[]` to {@link resolveKind}; because those narrow diagnostics are
 * structurally assignable here, a single shared helper covers all loaders.
 */
export interface LoaderDiagnostic {
  /** Stable, loader-specific diagnostic code. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Path associated with the diagnostic. */
  path: string;
  /** Diagnostic severity. Currently only warnings are emitted. */
  type: "warning";
}

/**
 * Split a markdown file into YAML frontmatter and body. Frontmatter is delimited
 * by leading/trailing `---` lines. Files without a leading `---` fence are
 * returned whole as the body with empty frontmatter. Uses the `yaml` package
 * (not gray-matter) for consistency across all sakti loaders.
 */
export function parseFrontmatter<T extends Record<string, unknown>>(
  content: string
): Result<{ frontmatter: T; body: string }, Error> {
  try {
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.startsWith("---")) {
      return ok({ frontmatter: {} as T, body: normalized });
    }
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex === -1) {
      return ok({ frontmatter: {} as T, body: normalized });
    }
    const yamlString = normalized.slice(4, endIndex);
    const body = normalized.slice(endIndex + 4).trim();
    return ok({ frontmatter: (parse(yamlString) ?? {}) as T, body });
  } catch (error) {
    return err(toError(error));
  }
}

/**
 * Resolve the effective kind of a {@link FileInfo}, following one symlink hop via
 * {@link ExecutionEnv.canonicalPath} when the entry is a symlink. Emits
 * `file_info_failed` diagnostics (rather than throwing) for unexpected errors;
 * missing targets resolve to `undefined`.
 */
export async function resolveKind(
  env: ExecutionEnv,
  info: FileInfo,
  diagnostics: LoaderDiagnostic[]
): Promise<"file" | "directory" | undefined> {
  if (info.kind === "file" || info.kind === "directory") {
    return info.kind;
  }
  const canonicalPath = await env.canonicalPath(info.path);
  if (isFailure(canonicalPath)) {
    if (canonicalPath.failure.code !== "not_found") {
      diagnostics.push({
        type: "warning",
        code: "file_info_failed",
        message: canonicalPath.failure.message,
        path: info.path,
      });
    }
    return;
  }
  const target = await env.fileInfo(canonicalPath.success);
  if (isFailure(target)) {
    if (target.failure.code !== "not_found") {
      diagnostics.push({
        type: "warning",
        code: "file_info_failed",
        message: target.failure.message,
        path: info.path,
      });
    }
    return;
  }
  return target.success.kind === "file" || target.success.kind === "directory"
    ? target.success.kind
    : undefined;
}

/** basename operating on env-style (forward-slash) path strings. */
export function basenameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

/** dirname operating on env-style (forward-slash) path strings. */
export function dirnameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
}

/** Effect-native variant of {@link resolveKind}. */
export const resolveKindEffect = (...args: Parameters<typeof resolveKind>) =>
  Effect.promise(() => resolveKind(...args));
