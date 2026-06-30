import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initDatabase } from "@sakti-code/db";
import type { Hono } from "hono";
import { createContext, ctxMiddleware } from "../context.ts";
import { factory } from "../factory.ts";
import { createAuthStore } from "../lib/auth-store.ts";
import { createProfilesStore } from "../lib/profiles-store.ts";
import { createSettingsFileStore } from "../lib/settings-file-store.ts";

type AnyHono = Hono;

export async function makeApp(routes: AnyHono[]) {
  const { ctx, db, tmpDir } = await makeContext();

  let rest = factory.createApp();
  for (const route of routes) {
    rest = rest.route("/", route);
  }

  const app = factory.createApp().use(ctxMiddleware(ctx)).route("/api", rest);
  return { app, db, ctx, tmpDir };
}

export async function makeContext() {
  const db = await initDatabase(new DatabaseSync(":memory:"));
  const tmpDir = mkdtempSync(join(tmpdir(), "sakti-test-"));
  const ctx = createContext(
    db,
    {},
    {
      auth: createAuthStore(join(tmpDir, "auth.json")),
      profiles: createProfilesStore(join(tmpDir, "profiles.json")),
      settingsFile: createSettingsFileStore(join(tmpDir, "settings.json")),
    },
  );
  return { ctx, db, tmpDir };
}

/** Seed a profile with a model for the given project (or global default). */
export function seedProfile(
  ctx: Awaited<ReturnType<typeof makeContext>>["ctx"],
  options: {
    provider: string;
    model: string;
    thinkingLevel?: string;
  },
) {
  ctx.profiles.writeAll({
    defaultProfile: "default",
    profiles: {
      default: {
        name: "Default",
        models: {
          default: {
            provider: options.provider,
            model: options.model,
            ...(options.thinkingLevel === undefined
              ? {}
              : { thinkingLevel: options.thinkingLevel }),
          },
        },
      },
    },
  });
}
