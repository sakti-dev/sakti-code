import type { Context } from "hono";
import type { Env } from "../../../index.js";

export interface DirectoryResolutionResult {
  ok: true;
  directory: string;
}

export interface DirectoryResolutionError {
  ok: false;
  reason: string;
}

export type DirectoryResolution = DirectoryResolutionResult | DirectoryResolutionError;

export function resolveDirectory(
  c: Context<Env>,
  options: { allowFallbackCwd?: boolean } = {}
): DirectoryResolution {
  const queryDir = c.req.query("directory")?.trim();
  const contextDir = c.get("instanceContext")?.directory?.trim();

  const raw = queryDir || contextDir || (options.allowFallbackCwd ? process.cwd() : "");

  if (!raw) {
    return { ok: false, reason: "Directory parameter required" };
  }

  if (!raw.trim()) {
    return { ok: false, reason: "Invalid directory parameter" };
  }

  if (/\u0000/.test(raw)) {
    return { ok: false, reason: "Invalid directory parameter" };
  }

  return { ok: true, directory: raw };
}
