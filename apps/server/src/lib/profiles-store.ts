import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CATALOG, PROVIDERS } from "@sakti-code/llm";
import Type from "typebox";
import { Value } from "typebox/value";

const modelRefSchema = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  thinkingLevel: Type.Optional(Type.String()),
});

const modelsSchema = Type.Object({
  default: modelRefSchema,
  intake: Type.Optional(modelRefSchema),
  plan: Type.Optional(modelRefSchema),
  build: Type.Optional(modelRefSchema),
});

const hybridSchema = Type.Object({
  enabled: Type.Boolean(),
  vision: Type.Optional(
    Type.Object({
      provider: Type.String(),
      model: Type.String(),
    }),
  ),
});

const profileSchema = Type.Object({
  name: Type.String(),
  models: modelsSchema,
  hybrid: Type.Optional(hybridSchema),
});

export const ProfilesSchema = Type.Object({
  defaultProfile: Type.String(),
  profiles: Type.Record(Type.String(), profileSchema),
});

export interface ModelRef {
  model: string;
  provider: string;
  thinkingLevel?: string;
}

export interface Profile {
  hybrid?: {
    enabled: boolean;
    vision?: { provider: string; model: string };
  };
  models: {
    default: ModelRef;
    intake?: ModelRef;
    plan?: ModelRef;
    build?: ModelRef;
  };
  name: string;
}

export interface Profiles {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

export interface ProfilesStore {
  /** Returns the mtimeMs of the file (0 if absent). Used for cache invalidation. */
  getMtimeMs(): number;
  /** Read and validate profiles.json. Returns a default if file is absent. Throws on malformed JSON. */
  read(): Profiles;
  /** Validate then atomically write the whole profiles file. Throws on validation failure. */
  writeAll(profiles: Profiles): void;
}

const DEFAULT_PROFILES: Profiles = {
  defaultProfile: "default",
  profiles: {
    default: {
      name: "Default",
      models: {
        default: { provider: "", model: "" },
      },
    },
  },
};

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function validateModelRefs(profiles: Profiles): void {
  for (const [profileId, profile] of Object.entries(profiles.profiles)) {
    for (const [mode, ref] of Object.entries(profile.models)) {
      if (!(ref?.provider && ref?.model)) {
        continue;
      }
      if (!PROVIDERS.includes(ref.provider)) {
        throw new Error(
          `Profile "${profileId}" mode "${mode}": unknown provider "${ref.provider}"`,
        );
      }
      const models = CATALOG[ref.provider];
      if (models && !models.some((m) => m.id === ref.model)) {
        throw new Error(
          `Profile "${profileId}" mode "${mode}": model "${ref.model}" not found for provider "${ref.provider}"`,
        );
      }
    }
  }
}

function validate(profiles: unknown): asserts profiles is Profiles {
  if (!Value.Check(ProfilesSchema, profiles)) {
    throw new Error("Invalid profiles: schema validation failed");
  }
  if (!(profiles.defaultProfile in profiles.profiles)) {
    throw new Error(
      `Invalid profiles: defaultProfile "${profiles.defaultProfile}" not found in profiles`,
    );
  }
  validateModelRefs(profiles);
}

export function createProfilesStore(filePath: string): ProfilesStore {
  return {
    read() {
      if (!existsSync(filePath)) {
        return DEFAULT_PROFILES;
      }
      const content = readFileSync(filePath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      validate(parsed);
      return parsed;
    },

    writeAll(profiles) {
      validate(profiles);
      ensureParentDir(filePath);
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(profiles, null, 2), "utf-8");
      renameSync(tmp, filePath);
    },

    getMtimeMs() {
      if (!existsSync(filePath)) {
        return 0;
      }
      return statSync(filePath).mtimeMs;
    },
  };
}
