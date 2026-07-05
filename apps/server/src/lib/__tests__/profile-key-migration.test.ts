import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { migrateProfileKeys } from "../profile-key-migration.ts";

describe("migrateProfileKeys", () => {
  it("renames intake→plan and plan→spec in models", () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-test-"));
    const path = join(dir, "profiles.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "p", model: "m" },
              intake: { provider: "p", model: "i" },
              plan: { provider: "p", model: "pl" },
            },
          },
        },
      }),
    );

    migrateProfileKeys(path);

    const result = JSON.parse(readFileSync(path, "utf-8"));
    expect(result.profiles.default.models.plan).toEqual({ provider: "p", model: "i" });
    expect(result.profiles.default.models.spec).toEqual({ provider: "p", model: "pl" });
    expect(result.profiles.default.models.intake).toBeUndefined();
  });

  it("is idempotent (running twice is safe)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-test-"));
    const path = join(dir, "profiles.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultProfile: "default",
        profiles: { default: { name: "D", models: { default: { provider: "p", model: "m" } } } },
      }),
    );

    migrateProfileKeys(path);
    migrateProfileKeys(path);

    const result = JSON.parse(readFileSync(path, "utf-8"));
    expect(result.profiles.default.models.default).toEqual({ provider: "p", model: "m" });
  });

  it("skips when file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-test-"));
    expect(() => migrateProfileKeys(join(dir, "nonexistent.json"))).not.toThrow();
  });
});
