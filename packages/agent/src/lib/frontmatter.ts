import { Effect } from "effect";
import { parse } from "yaml";
import type { ExecutionEnv, FileInfo } from "../harness-types";
import { err, isFailure, ok, type Result, toError } from "../lib/result";

export interface LoaderDiagnostic {
  code: string;
  message: string;
  path: string;
  type: "warning";
}

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

export function basenameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

export function dirnameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
}

export const resolveKindEffect = (...args: Parameters<typeof resolveKind>) =>
  Effect.promise(() => resolveKind(...args));
