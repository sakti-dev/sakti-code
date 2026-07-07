import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { getAgentDir } from "./config-dirs.ts";

const require = createRequire(import.meta.url);

/** Resolve the sakti CLI binary path from the workspace dependency. */
export function resolveSaktiCliPath(): string {
  return require.resolve("@sakti-code/sakti/dist/cli.mjs");
}

/** Directory where the `sakti` symlink lives — sibling of the agent dir. */
export function getSaktiBinDir(): string {
  return join(dirname(getAgentDir()), "bin");
}

/** Pure helper: prepend binDir to PATH if not already present. */
export function buildPathWithBinDir(binDir: string, currentPath: string | undefined): string {
  const path = currentPath ?? "";
  const entries = path.split(":");
  if (entries.includes(binDir)) {
    return path;
  }
  return `${binDir}:${path}`;
}

export interface EnsureSaktiOnPathOptions {
  /** Override the CLI path resolver (for testing). */
  resolveCliPath?: () => string;
  /** Override the bin directory (for testing). */
  getBinDir?: () => string;
}

/**
 * Ensures the `sakti` CLI is on PATH for subprocesses spawned by the bash
 * tool. Creates a symlink `sakti` → resolved CLI path inside the bin dir,
 * then prepends the bin dir to `process.env.PATH`.
 *
 * Idempotent: safe to call on every server boot. The symlink always points
 * at the version bundled with the running server — no version mismatch.
 */
export function ensureSaktiOnPath(options?: EnsureSaktiOnPathOptions): void {
  const resolveFn = options?.resolveCliPath ?? resolveSaktiCliPath;
  const binDirFn = options?.getBinDir ?? getSaktiBinDir;

  let cliPath: string;
  try {
    cliPath = resolveFn();
  } catch {
    return;
  }

  const binDir = binDirFn();
  mkdirSync(binDir, { recursive: true });

  const linkPath = join(binDir, "sakti");
  rmSync(linkPath, { force: true });
  symlinkSync(cliPath, linkPath);

  process.env.PATH = buildPathWithBinDir(binDir, process.env.PATH);
}
