import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Profiles, ProfilesStore } from "./profiles-store.ts";
import type { SettingsFileStore } from "./settings-file-store.ts";

export interface GlobalModelConfig {
  model: string;
  provider: string;
  thinkingLevel?: string;
}

export interface MigrationDeps {
  authPath: string;
  getAllSettings: () => Array<{ key: string; value: string }>;
  /** Global model config read from `model_configs` before the table is dropped. Null if absent. */
  globalModelConfig: GlobalModelConfig | null;
  legacyKeysPath: string;
  profilesPath: string;
  profilesStore: ProfilesStore;
  settingsFileStore: SettingsFileStore;
  settingsPath: string;
}

/**
 * Build the seed profiles object. If a global model_config was found in the
 * legacy DB, use its provider/model/thinkingLevel; otherwise write a minimal
 * default with empty strings so the user is prompted to configure.
 */
function buildSeedProfiles(globalModelConfig: GlobalModelConfig | null): Profiles {
  const models = globalModelConfig
    ? {
        default: {
          provider: globalModelConfig.provider,
          model: globalModelConfig.model,
          ...(globalModelConfig.thinkingLevel === undefined
            ? {}
            : { thinkingLevel: globalModelConfig.thinkingLevel }),
        },
      }
    : { default: { provider: "", model: "" } };

  return {
    defaultProfile: "default",
    profiles: {
      default: {
        name: "Default",
        models,
      },
    },
  };
}

/**
 * One-time non-destructive config migration.
 * Copies legacy api-keys.json → auth.json, seeds profiles.json and settings.json.
 * Guarded by a sentinel file so it never repeats.
 * Never deletes legacy sources; skips on parse error.
 */
export function runMigration(sentinelPath: string, deps: MigrationDeps): void {
  if (existsSync(sentinelPath)) {
    return;
  }

  const dir = dirname(deps.authPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Step 1: copy legacy api-keys.json → auth.json (if auth.json absent and legacy exists)
  if (!existsSync(deps.authPath) && existsSync(deps.legacyKeysPath)) {
    try {
      const content = readFileSync(deps.legacyKeysPath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, string>;
      const json = JSON.stringify(parsed, null, 2);
      writeFileSync(deps.authPath, json, { encoding: "utf-8", mode: 0o600 });
      chmodSync(deps.authPath, 0o600);
    } catch {
      // Corrupt legacy file — skip, leave it in place
    }
  }

  // Step 2: seed profiles.json only if it does not exist
  if (!existsSync(deps.profilesPath)) {
    deps.profilesStore.writeAll(buildSeedProfiles(deps.globalModelConfig));
  }

  // Step 3: seed settings.json from non-session DB rows (only if file does not exist)
  if (!existsSync(deps.settingsPath)) {
    const settingsRows = deps.getAllSettings();
    const globalSettings: Record<string, unknown> = {};
    for (const row of settingsRows) {
      if (!row.key.startsWith("session:")) {
        globalSettings[row.key] = parseValue(row.value);
      }
    }
    deps.settingsFileStore.update(globalSettings);
  }

  // Step 4: write sentinel
  writeFileSync(sentinelPath, "", "utf-8");
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
