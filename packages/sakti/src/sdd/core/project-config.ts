import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

export interface ProjectConfig {
  schema: string;
}

/** Shared .yaml/.yml probe. */
export function resolveConfigFilePath(projectRoot: string): string | null {
  const yamlPath = path.join(projectRoot, ".sakti", "config.yaml");
  if (existsSync(yamlPath)) {
    return yamlPath;
  }
  const ymlPath = path.join(projectRoot, ".sakti", "config.yml");
  return existsSync(ymlPath) ? ymlPath : null;
}

/**
 * Read and parse .sakti/config.yaml from project root.
 * Only the `schema` field is consumed; other fields are ignored.
 * Returns null if file doesn't exist or is unparseable.
 */
export function readProjectConfig(projectRoot: string): ProjectConfig | null {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const raw = parseYaml(content);

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      console.warn(".sakti/config.yaml is not a valid YAML object");
      return null;
    }

    const schema = (raw as Record<string, unknown>).schema;
    if (typeof schema === "string" && schema.length > 0) {
      return { schema };
    }

    return null;
  } catch (error) {
    console.warn(
      `Warning: could not parse .sakti/config.yaml (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); ignoring it.`,
    );
    return null;
  }
}

export interface SaktiDirClassification {
  /** True when .sakti/specs or .sakti/changes exists as a directory. */
  hasPlanningShape: boolean;
  /** True when .sakti/config.yaml or config.yml exists. */
  hasConfigFile: boolean;
}

/**
 * Classify whether a directory has real planning shape (specs/changes dirs)
 * or is just a config-only pointer dir. Used by root resolution.
 */
export function classifySaktiDir(projectRoot: string): SaktiDirClassification {
  const saktiDir = path.join(projectRoot, ".sakti");
  const hasPlanningShape =
    isDirectorySync(path.join(saktiDir, "specs")) ||
    isDirectorySync(path.join(saktiDir, "changes"));
  return {
    hasPlanningShape,
    hasConfigFile: resolveConfigFilePath(projectRoot) !== null,
  };
}

function isDirectorySync(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}
