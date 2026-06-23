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
import {
  createProfilesStore,
  type Profiles,
  type ProfilesStore,
} from "../profiles-store.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sakti-profiles-test-"));
}

const VALID_PROFILES: Profiles = {
  defaultProfile: "balanced",
  profiles: {
    balanced: {
      name: "Balanced",
      models: {
        default: { provider: "anthropic", model: "claude-sonnet" },
      },
    },
  },
};

describe("ProfilesStore", () => {
  let dir: string;
  let filePath: string;
  let store: ProfilesStore;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "profiles.json");
    store = createProfilesStore(filePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("read returns a default when file is absent", () => {
    const profiles = store.read();
    expect(profiles.defaultProfile).toBe("default");
    expect(profiles.profiles.default).toBeDefined();
    expect(profiles.profiles.default?.models.default).toBeDefined();
  });

  it("writeAll then read round-trips valid profiles", () => {
    store.writeAll(VALID_PROFILES);
    const read = store.read();
    expect(read).toEqual(VALID_PROFILES);
  });

  it("writeAll is atomic (temp+rename, no partial file)", () => {
    store.writeAll(VALID_PROFILES);
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(raw).toEqual(VALID_PROFILES);
  });

  it("writeAll with invalid body does not touch the file", () => {
    store.writeAll(VALID_PROFILES);
    const original = readFileSync(filePath, "utf-8");

    const invalid = {
      defaultProfile: "missing-profile",
      profiles: {},
    } as unknown as Profiles;

    expect(() => store.writeAll(invalid)).toThrow();
    expect(readFileSync(filePath, "utf-8")).toBe(original);
  });

  it("writeAll rejects missing defaultProfile", () => {
    const invalid = {
      profiles: {},
    } as unknown as Profiles;
    expect(() => store.writeAll(invalid)).toThrow();
  });

  it("writeAll rejects profile without models.default", () => {
    const invalid = {
      defaultProfile: "bad",
      profiles: {
        bad: { name: "Bad", models: {} },
      },
    } as unknown as Profiles;
    expect(() => store.writeAll(invalid)).toThrow();
  });

  it("writeAll accepts optional mode overrides", () => {
    const withModes: Profiles = {
      defaultProfile: "pro",
      profiles: {
        pro: {
          name: "Pro",
          models: {
            default: { provider: "anthropic", model: "claude-sonnet" },
            plan: { provider: "openai", model: "gpt-4o" },
          },
        },
      },
    };
    store.writeAll(withModes);
    expect(store.read()).toEqual(withModes);
  });

  it("writeAll accepts hybrid block", () => {
    const withHybrid: Profiles = {
      defaultProfile: "hybrid",
      profiles: {
        hybrid: {
          name: "Hybrid",
          models: {
            default: { provider: "anthropic", model: "claude-sonnet" },
          },
          hybrid: {
            enabled: true,
            vision: { provider: "google", model: "gemini-2.5-flash" },
          },
        },
      },
    };
    store.writeAll(withHybrid);
    expect(store.read()).toEqual(withHybrid);
  });

  it("read throws on malformed JSON in file", () => {
    store.writeAll(VALID_PROFILES);
    // Corrupt the file
    writeFileSync(filePath, "{ broken json");
    expect(() => store.read()).toThrow();
  });

  it("getMtimeMs returns 0 when file absent", () => {
    expect(store.getMtimeMs()).toBe(0);
  });

  it("getMtimeMs returns a positive number after write", () => {
    store.writeAll(VALID_PROFILES);
    expect(store.getMtimeMs()).toBeGreaterThan(0);
  });
});
