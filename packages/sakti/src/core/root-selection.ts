/**
 * Shared Sakti root resolution for normal commands.
 *
 * Normal commands (`new change`, `status`, `list`, `show`, `validate`,
 * `archive`) resolve one Sakti root through this module: the nearest
 * ancestor containing a qualifying `.sakti/` directory wins. With no
 * nearest root, commands may treat the current directory as an implicit
 * root.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { findRepoPlanningRootSync } from './planning-home.js';
import { classifySaktiDir } from './project-config.js';
import { FileSystemUtils } from '../utils/file-system.js';

export type SaktiRootSource = 'nearest' | 'implicit';

export interface ResolveSaktiRootOptions {
  startPath?: string;
  allowImplicitRoot?: boolean;
}

export interface ResolvedSaktiRoot {
  path: string;
  changesDir: string;
  specsDir: string;
  archiveDir: string;
  defaultSchema: 'spec-driven';
  source: SaktiRootSource;
}

export interface RootSelectionDiagnostic {
  severity: 'error';
  code: string;
  message: string;
  target?: string;
  fix?: string;
}

export class RootSelectionError extends Error {
  readonly diagnostic: RootSelectionDiagnostic;

  constructor(
    message: string,
    code: string,
    options: { target?: string; fix?: string } = {},
  ) {
    super(message);
    this.name = 'RootSelectionError';
    this.diagnostic = {
      severity: 'error',
      code,
      message,
      ...options,
    };
  }
}

export function isRootSelectionError(error: unknown): error is RootSelectionError {
  return error instanceof RootSelectionError;
}

function makeRoot(
  rootPath: string,
  source: SaktiRootSource,
): ResolvedSaktiRoot {
  return {
    path: rootPath,
    changesDir: path.join(rootPath, '.sakti', 'changes'),
    specsDir: path.join(rootPath, '.sakti', 'specs'),
    archiveDir: path.join(rootPath, '.sakti', 'changes', 'archive'),
    defaultSchema: 'spec-driven',
    source,
  };
}

function canonicalDirectory(startPath: string): string {
  const resolved = path.resolve(startPath);

  try {
    const stats = fs.statSync(resolved);
    const dir = stats.isDirectory() ? resolved : path.dirname(resolved);
    return FileSystemUtils.canonicalizeExistingPath(dir);
  } catch {
    return resolved;
  }
}

/**
 * The nearest-root walk, qualified: a `.sakti/` DIRECTORY alone is
 * not a root — it must carry a planning shape or a config file.
 * Without this, the recommended layout would make $HOME a phantom
 * root that captures every command under the home tree.
 */
function findQualifyingRootSync(startPath: string): string | null {
  let candidate = findRepoPlanningRootSync(startPath);
  while (candidate) {
    const { hasPlanningShape, pointer } = classifySaktiDir(candidate);
    if (hasPlanningShape || pointer.filePath) {
      return candidate;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = findRepoPlanningRootSync(parent);
  }
  return null;
}

export async function resolveSaktiRoot(
  options: ResolveSaktiRootOptions = {},
): Promise<ResolvedSaktiRoot> {
  const startPath = options.startPath ?? process.cwd();
  const nearestRoot = findQualifyingRootSync(startPath);
  if (nearestRoot) {
    return makeRoot(nearestRoot, 'nearest');
  }

  if (options.allowImplicitRoot === false) {
    throw new RootSelectionError(
      'No Sakti root found from the current directory.',
      'no_sakti_root',
      { target: 'sakti.root', fix: 'Run sakti new change to create a root here.' },
    );
  }

  return makeRoot(canonicalDirectory(startPath), 'implicit');
}

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------

export interface RootOutput {
  path: string;
  source: SaktiRootSource;
}

export function toRootOutput(root: ResolvedSaktiRoot): RootOutput {
  return {
    path: root.path,
    source: root.source,
  };
}

/**
 * CLI adapter shared by the supported commands. In JSON mode a resolution
 * failure is reported as a machine-readable payload on stdout (no human prose
 * or blank lines) with a non-zero exit code; the caller must return when this
 * resolves to null. In human mode the error propagates to the command's
 * standard error handling so message text and exit behavior stay consistent.
 */
export async function resolveRootForCommand(
  options: {
    json?: boolean;
    failurePayload?: Record<string, unknown>;
    /** Diagnostic commands inspect what exists; they never scaffold. */
    allowImplicitRoot?: boolean;
  } = {},
): Promise<ResolvedSaktiRoot | null> {
  try {
    return await resolveSaktiRoot(
      options.allowImplicitRoot !== undefined
        ? { allowImplicitRoot: options.allowImplicitRoot }
        : {},
    );
  } catch (error) {
    if (options.json && isRootSelectionError(error)) {
      console.log(
        JSON.stringify(
          { ...(options.failurePayload ?? {}), status: [error.diagnostic] },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return null;
    }

    throw error;
  }
}
