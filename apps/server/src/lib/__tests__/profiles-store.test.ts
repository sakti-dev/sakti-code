import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfilesStore } from "../profiles-store.ts";

const tmpDir = join(tmpdir(), `sakti-profiles-test-${Date.now()}`);
const profilesPath = join(tmpDir, "profiles.json");

beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

const UNKNOWN_PROVIDER_RE = /unknown provider/i;
const MODEL_NOT_FOUND_RE = /model.*not found/i;

describe("profiles store — referential validation", () => {
  it("rejects unknown provider", () => {
    const store = createProfilesStore(profilesPath);
    expect(() =>
      store.writeAll({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "not-a-real-provider", model: "gpt-4" },
            },
          },
        },
      })
    ).toThrow(UNKNOWN_PROVIDER_RE);
  });

  it("rejects unknown model for a known provider", () => {
    const store = createProfilesStore(profilesPath);
    expect(() =>
      store.writeAll({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "openai",
                model: "does-not-exist-xyz",
              },
            },
          },
        },
      })
    ).toThrow(MODEL_NOT_FOUND_RE);
  });

  it("accepts empty provider+model (initial state)", () => {
    const store = createProfilesStore(profilesPath);
    expect(() =>
      store.writeAll({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "", model: "" },
            },
          },
        },
      })
    ).not.toThrow();
  });

  it("accepts valid provider+model from catalog", () => {
    const store = createProfilesStore(profilesPath);
    expect(() =>
      store.writeAll({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "anthropic",
                model: "claude-sonnet-4-20250514",
              },
            },
          },
        },
      })
    ).not.toThrow();
  });
});
