import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type SettingsData = Record<string, unknown>;

export interface SettingsFileStore {
  /** Read settings.json. Returns `{}` if file is absent. Throws on malformed JSON. */
  read(): SettingsData;
  /** Deep-merge `partial` into the existing settings and atomically write. */
  update(partial: SettingsData): void;
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function createSettingsFileStore(filePath: string): SettingsFileStore {
  return {
    read() {
      if (!existsSync(filePath)) {
        return {};
      }
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SettingsData;
    },

    update(partial) {
      ensureParentDir(filePath);
      const current = existsSync(filePath)
        ? (JSON.parse(readFileSync(filePath, "utf-8")) as SettingsData)
        : {};
      const merged = deepMerge(current, partial);
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf-8");
      renameSync(tmp, filePath);
    },
  };
}
