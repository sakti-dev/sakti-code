import * as fs from "node:fs/promises";
import * as path from "node:path";

import { FileSystemUtils } from "../utils/file-system.js";
import { serializeConfig } from "./config-prompts.js";
import { makeDiagnostic, type Diagnostic } from "./errors.js";

export const SAKTI_ROOT_DIR = ".sakti";
export const SAKTI_CONFIG_YAML = ".sakti/config.yaml";
export const SAKTI_CONFIG_YML = ".sakti/config.yml";
export const SAKTI_SPECS_DIR = ".sakti/specs";
export const SAKTI_CHANGES_DIR = ".sakti/changes";
export const SAKTI_ARCHIVE_DIR = ".sakti/changes/archive";
export const DEFAULT_SAKTI_SCHEMA = "spec-driven";
export const DIRECTORY_ANCHOR_FILE_NAME = ".gitkeep";

// Git cannot track empty directories, so clones of a fresh store would lose
// these and fail root-health checks. Anchored at setup time.
export const ANCHORED_SAKTI_DIRS = [SAKTI_SPECS_DIR, SAKTI_ARCHIVE_DIR] as const;

type PathKind = "missing" | "directory" | "file" | "other";

export interface CreatedPathLedgerEntry {
  relativePath: string;
  absolutePath: string;
  kind: "directory" | "file";
}

export interface SaktiRootInspection {
  present: boolean | null;
  config: {
    present: boolean | null;
    path?: string;
  };
  specs: {
    present: boolean | null;
  };
  changes: {
    present: boolean | null;
  };
  archive: {
    present: boolean | null;
  };
  healthy: boolean;
  diagnostics: Diagnostic[];
}

export interface EnsureSaktiRootResult {
  inspection: SaktiRootInspection;
  createdArtifacts: string[];
  createdPaths: CreatedPathLedgerEntry[];
}

async function pathKind(targetPath: string): Promise<PathKind> {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return "missing";
    }

    throw error;
  }
}

function relativeArtifact(relativePath: string, kind: CreatedPathLedgerEntry["kind"]): string {
  const normalized = FileSystemUtils.toPosixPath(relativePath);
  return kind === "directory" ? `${normalized}/` : normalized;
}

function unresolvedInspection(): SaktiRootInspection {
  return {
    present: null,
    config: { present: null },
    specs: { present: null },
    changes: { present: null },
    archive: { present: null },
    healthy: false,
    diagnostics: [],
  };
}

function missingDirectoryDiagnostic(code: string, message: string, target: string): Diagnostic {
  return makeDiagnostic("error", code, message, { target });
}

export async function inspectSaktiRoot(storeRoot: string): Promise<SaktiRootInspection> {
  const rootKind = await pathKind(storeRoot);
  const inspection = unresolvedInspection();

  if (rootKind === "missing") {
    inspection.diagnostics.push(
      missingDirectoryDiagnostic(
        "sakti_store_root_missing",
        "Store root does not exist.",
        "store.root",
      ),
    );
    return inspection;
  }

  if (rootKind !== "directory") {
    inspection.diagnostics.push(
      missingDirectoryDiagnostic(
        "sakti_store_root_not_directory",
        "Store root is not a directory.",
        "store.root",
      ),
    );
    return inspection;
  }

  const saktiPath = path.join(storeRoot, SAKTI_ROOT_DIR);
  const saktiKind = await pathKind(saktiPath);
  inspection.present = saktiKind === "directory";

  if (saktiKind === "missing") {
    inspection.diagnostics.push(
      missingDirectoryDiagnostic("sakti_root_missing", "Missing sakti/ directory.", "sakti.root"),
    );
    return inspection;
  }

  if (saktiKind !== "directory") {
    inspection.diagnostics.push(
      missingDirectoryDiagnostic(
        "sakti_root_not_directory",
        "sakti/ exists but is not a directory.",
        "sakti.root",
      ),
    );
    return inspection;
  }

  const configYamlKind = await pathKind(path.join(storeRoot, SAKTI_CONFIG_YAML));
  const configYmlKind = await pathKind(path.join(storeRoot, SAKTI_CONFIG_YML));
  if (configYamlKind === "file") {
    inspection.config = { present: true, path: SAKTI_CONFIG_YAML };
  } else if (configYmlKind === "file") {
    inspection.config = { present: true, path: SAKTI_CONFIG_YML };
  } else {
    inspection.config = { present: false };
    if (configYamlKind !== "missing" || configYmlKind !== "missing") {
      inspection.diagnostics.push(
        missingDirectoryDiagnostic(
          "sakti_config_not_file",
          "Sakti config path exists but is not a file.",
          "sakti.config",
        ),
      );
    } else {
      inspection.diagnostics.push(
        missingDirectoryDiagnostic(
          "sakti_config_missing",
          "Missing sakti/config.yaml or sakti/config.yml.",
          "sakti.config",
        ),
      );
    }
  }

  for (const [key, relativePath, code, message, target] of [
    ["specs", SAKTI_SPECS_DIR, "sakti_specs_missing", "Missing sakti/specs/.", "sakti.specs"],
    [
      "changes",
      SAKTI_CHANGES_DIR,
      "sakti_changes_missing",
      "Missing sakti/changes/.",
      "sakti.changes",
    ],
    [
      "archive",
      SAKTI_ARCHIVE_DIR,
      "sakti_archive_missing",
      "Missing sakti/changes/archive/.",
      "sakti.archive",
    ],
  ] as const) {
    const kind = await pathKind(path.join(storeRoot, relativePath));
    inspection[key] = { present: kind === "directory" };
    if (kind === "directory") continue;

    inspection.diagnostics.push(
      missingDirectoryDiagnostic(
        kind === "missing" ? code : code.replace("_missing", "_not_directory"),
        kind === "missing" ? message : `${relativePath}/ exists but is not a directory.`,
        target,
      ),
    );
  }

  inspection.healthy =
    inspection.present === true &&
    inspection.config.present === true &&
    inspection.specs.present === true &&
    inspection.changes.present === true &&
    inspection.archive.present === true;

  return inspection;
}

async function ensureDirectory(
  storeRoot: string,
  relativePath: string,
  ledger: CreatedPathLedgerEntry[],
): Promise<void> {
  const absolutePath = path.join(storeRoot, relativePath);
  const kind = await pathKind(absolutePath);

  if (kind === "directory") return;
  if (kind !== "missing") {
    throw new Error(`${relativePath}/ exists but is not a directory.`);
  }

  await fs.mkdir(absolutePath, { recursive: true });
  ledger.push({
    relativePath: relativeArtifact(relativePath, "directory"),
    absolutePath,
    kind: "directory",
  });
}

async function ensureDefaultConfig(
  storeRoot: string,
  ledger: CreatedPathLedgerEntry[],
): Promise<void> {
  const configYamlPath = path.join(storeRoot, SAKTI_CONFIG_YAML);
  const configYmlPath = path.join(storeRoot, SAKTI_CONFIG_YML);
  const yamlKind = await pathKind(configYamlPath);
  const ymlKind = await pathKind(configYmlPath);

  if (yamlKind === "file" || ymlKind === "file") return;
  if (yamlKind !== "missing" || ymlKind !== "missing") {
    throw new Error("Sakti config path exists but is not a file.");
  }

  await FileSystemUtils.writeFile(
    configYamlPath,
    serializeConfig({ schema: DEFAULT_SAKTI_SCHEMA }),
  );
  ledger.push({
    relativePath: relativeArtifact(SAKTI_CONFIG_YAML, "file"),
    absolutePath: configYamlPath,
    kind: "file",
  });
}

async function ensureDirectoryAnchor(
  storeRoot: string,
  relativeDir: string,
  ledger: CreatedPathLedgerEntry[],
): Promise<void> {
  const directory = path.join(storeRoot, relativeDir);
  if ((await fs.readdir(directory)).length > 0) return;

  const relativePath = `${relativeDir}/${DIRECTORY_ANCHOR_FILE_NAME}`;
  const absolutePath = path.join(directory, DIRECTORY_ANCHOR_FILE_NAME);
  await fs.writeFile(absolutePath, "", "utf-8");
  ledger.push({
    relativePath: relativeArtifact(relativePath, "file"),
    absolutePath,
    kind: "file",
  });
}

export interface EnsureSaktiRootOptions {
  anchorEmptyDirectories?: boolean;
}

export async function ensureSaktiRoot(
  storeRoot: string,
  options: EnsureSaktiRootOptions = {},
): Promise<EnsureSaktiRootResult> {
  const ledger: CreatedPathLedgerEntry[] = [];
  const rootKind = await pathKind(storeRoot);

  if (rootKind === "missing") {
    await fs.mkdir(storeRoot, { recursive: true });
  } else if (rootKind !== "directory") {
    throw new Error("Store root is not a directory.");
  }

  await ensureDirectory(storeRoot, SAKTI_ROOT_DIR, ledger);
  await ensureDirectory(storeRoot, SAKTI_SPECS_DIR, ledger);
  await ensureDirectory(storeRoot, SAKTI_CHANGES_DIR, ledger);
  await ensureDirectory(storeRoot, SAKTI_ARCHIVE_DIR, ledger);
  await ensureDefaultConfig(storeRoot, ledger);

  if (options.anchorEmptyDirectories) {
    for (const relativeDir of ANCHORED_SAKTI_DIRS) {
      await ensureDirectoryAnchor(storeRoot, relativeDir, ledger);
    }
  }

  return {
    inspection: await inspectSaktiRoot(storeRoot),
    createdArtifacts: ledger.map((entry) => entry.relativePath),
    createdPaths: ledger,
  };
}

export async function rollbackCreatedPaths(entries: CreatedPathLedgerEntry[]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.kind === "file") {
      await fs.rm(entry.absolutePath, { force: true }).catch(() => undefined);
    } else {
      await fs.rmdir(entry.absolutePath).catch(() => undefined);
    }
  }
}
