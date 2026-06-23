import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MigrationDeps, runMigration } from "../config-migration.ts";
import { createProfilesStore } from "../profiles-store.ts";
import { createSettingsFileStore } from "../settings-file-store.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sakti-migration-test-"));
}

describe("config-migration", () => {
  let agentDir: string;
  let legacyDir: string;
  let legacyKeysPath: string;
  let profilesPath: string;
  let settingsPath: string;

  beforeEach(() => {
    agentDir = makeTmpDir();
    legacyDir = makeTmpDir();
    legacyKeysPath = join(legacyDir, "api-keys.json");
    profilesPath = join(agentDir, "profiles.json");
    settingsPath = join(agentDir, "settings.json");
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(legacyDir, { recursive: true, force: true });
  });

  function makeDeps(overrides: Partial<MigrationDeps> = {}): MigrationDeps {
    return {
      legacyKeysPath,
      authPath: join(agentDir, "auth.json"),
      profilesPath,
      settingsPath,
      profilesStore: createProfilesStore(profilesPath),
      settingsFileStore: createSettingsFileStore(settingsPath),
      globalModelConfig: null,
      getAllSettings: () => [],
      ...overrides,
    };
  }

  it("copies legacy api-keys.json to auth.json on first run", () => {
    writeFileSync(
      legacyKeysPath,
      JSON.stringify({ openai: "sk-test-key-12345" })
    );

    runMigration(join(agentDir, ".migrated"), makeDeps());

    const auth = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf-8"));
    expect(auth.openai).toBe("sk-test-key-12345");
  });

  it("preserves the legacy file (copy, not move)", () => {
    writeFileSync(legacyKeysPath, JSON.stringify({ anthropic: "sk-ant-test" }));

    runMigration(join(agentDir, ".migrated"), makeDeps());

    expect(existsSync(legacyKeysPath)).toBe(true);
  });

  it("writes profiles.json with minimal default when no global model config", () => {
    runMigration(join(agentDir, ".migrated"), makeDeps());

    const profiles = createProfilesStore(profilesPath).read();
    expect(profiles.defaultProfile).toBe("default");
    expect(profiles.profiles.default).toBeDefined();
  });

  it("seeds profiles.json from globalModelConfig when provided", () => {
    runMigration(
      join(agentDir, ".migrated"),
      makeDeps({
        globalModelConfig: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          thinkingLevel: "high",
        },
      })
    );

    const profiles = createProfilesStore(profilesPath).read();
    expect(profiles.profiles.default?.models.default?.provider).toBe(
      "anthropic"
    );
    expect(profiles.profiles.default?.models.default?.model).toBe(
      "claude-sonnet-4-20250514"
    );
    expect(profiles.profiles.default?.models.default?.thinkingLevel).toBe(
      "high"
    );
  });

  it("seeds profiles.json with minimal default when globalModelConfig is null", () => {
    runMigration(join(agentDir, ".migrated"), makeDeps());

    const profiles = createProfilesStore(profilesPath).read();
    expect(profiles.profiles.default?.models.default?.provider).toBe("");
    expect(profiles.profiles.default?.models.default?.model).toBe("");
  });

  it("does not overwrite profiles.json if it already exists", () => {
    const existing = {
      defaultProfile: "custom",
      profiles: {
        custom: {
          name: "Custom",
          models: {
            default: { provider: "openai", model: "gpt-4o" },
          },
        },
      },
    };
    createProfilesStore(profilesPath).writeAll(existing);

    runMigration(
      join(agentDir, ".migrated"),
      makeDeps({
        globalModelConfig: {
          provider: "anthropic",
          model: "claude-sonnet",
        },
      })
    );

    const profiles = createProfilesStore(profilesPath).read();
    expect(profiles.defaultProfile).toBe("custom");
    expect(profiles.profiles.custom?.models.default?.provider).toBe("openai");
  });

  it("seeds settings.json from non-session settings rows", () => {
    runMigration(
      join(agentDir, ".migrated"),
      makeDeps({
        getAllSettings: () => [
          { key: "theme", value: "dark" },
          { key: "session:sess_1:auto_compaction", value: "true" },
        ],
      })
    );

    const settings = createSettingsFileStore(settingsPath).read();
    expect(settings.theme).toBe("dark");
    expect(settings["session:sess_1:auto_compaction"]).toBeUndefined();
  });

  it("does not overwrite settings.json if it already exists", () => {
    createSettingsFileStore(settingsPath).update({ theme: "light" });

    runMigration(
      join(agentDir, ".migrated"),
      makeDeps({
        getAllSettings: () => [{ key: "theme", value: "dark" }],
      })
    );

    const settings = createSettingsFileStore(settingsPath).read();
    expect(settings.theme).toBe("light");
  });

  it("writes the sentinel on completion", () => {
    runMigration(join(agentDir, ".migrated"), makeDeps());

    expect(existsSync(join(agentDir, ".migrated"))).toBe(true);
  });

  it("does not repeat when sentinel exists", () => {
    const sentinelPath = join(agentDir, ".migrated");
    writeFileSync(sentinelPath, "");

    writeFileSync(
      legacyKeysPath,
      JSON.stringify({ openai: "sk-should-not-copy" })
    );

    runMigration(sentinelPath, makeDeps());

    expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
  });

  it("skips corrupt legacy file without crashing", () => {
    writeFileSync(legacyKeysPath, "{ broken json");

    runMigration(join(agentDir, ".migrated"), makeDeps());

    expect(existsSync(join(agentDir, ".migrated"))).toBe(true);
    expect(existsSync(profilesPath)).toBe(true);
    expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
  });

  it("per-source independence: auth copied even when no settings", () => {
    writeFileSync(
      legacyKeysPath,
      JSON.stringify({ openai: "sk-key-1234567890" })
    );

    runMigration(join(agentDir, ".migrated"), makeDeps());

    expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
  });

  it("does not overwrite auth.json if it already exists", () => {
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({ existing: "sk-existing-key" })
    );
    writeFileSync(
      legacyKeysPath,
      JSON.stringify({ openai: "sk-should-not-overwrite" })
    );

    runMigration(join(agentDir, ".migrated"), makeDeps());

    const auth = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf-8"));
    expect(auth.existing).toBe("sk-existing-key");
    expect(auth.openai).toBeUndefined();
  });
});
