import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve, type WebSocketServerLike } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { initDatabase, settings as settingsTable } from "@sakti-code/db";
import { WebSocketServer } from "ws";
import { buildApp } from "./app.ts";
import { createContext } from "./context.ts";
import { createAuthStore } from "./lib/auth-store.ts";
import {
  getAuthPath,
  getDbPath,
  getMigratedSentinelPath,
  getProfilesPath,
  getSettingsPath,
} from "./lib/config-dirs.ts";
import { runMigration } from "./lib/config-migration.ts";
import { createServerLoggers } from "./lib/loggers.ts";
import { createProfilesStore } from "./lib/profiles-store.ts";
import { createSettingsFileStore } from "./lib/settings-file-store.ts";

export interface ServerHooks {
  onOpenFolderDialog?: () => Promise<string | null>;
}

export interface CreateServerOptions {
  dbPath?: string;
  hooks?: ServerHooks;
  hostname?: string;
  migrationsFolder?: string;
  port?: number;
  staticDir?: string | null;
}

export interface SaktiServer {
  hostname: string;
  port: number;
  stop(): Promise<void>;
  url: string;
}

export async function createServer(
  options?: CreateServerOptions
): Promise<SaktiServer> {
  const {
    port = Number(process.env.SAKTI_PORT ?? 3001),
    hostname = process.env.SAKTI_HOST ?? "localhost",
    dbPath = getDbPath(),
    staticDir = null,
    hooks = {},
    migrationsFolder,
  } = options ?? {};

  const rawDb = new DatabaseSync(dbPath);

  // Read global model_config BEFORE initDatabase applies migrations that drop the table
  let globalModelConfig: {
    provider: string;
    model: string;
    thinkingLevel?: string;
  } | null = null;
  try {
    const row = rawDb
      .prepare(
        "SELECT provider, model_id, thinking_level FROM model_configs WHERE project_id IS NULL LIMIT 1"
      )
      .get() as
      | { provider: string; model_id: string; thinking_level: string }
      | undefined;
    if (row) {
      globalModelConfig = {
        provider: row.provider,
        model: row.model_id,
        thinkingLevel: row.thinking_level,
      };
    }
  } catch {
    // Table doesn't exist (fresh install or already migrated)
  }

  const db = await initDatabase(
    rawDb,
    migrationsFolder === undefined ? {} : { migrationsFolder }
  );

  const authPath = getAuthPath();
  const profilesPath = getProfilesPath();
  const settingsPath = getSettingsPath();

  const auth = createAuthStore(authPath);
  const profiles = createProfilesStore(profilesPath);
  const settingsFile = createSettingsFileStore(settingsPath);

  runMigration(getMigratedSentinelPath(), {
    legacyKeysPath:
      process.env.SAKTI_KEYS_PATH ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "sakti-code",
        "api-keys.json"
      ),
    authPath,
    profilesPath,
    settingsPath,
    profilesStore: profiles,
    settingsFileStore: settingsFile,
    globalModelConfig,
    getAllSettings: () =>
      db.select().from(settingsTable).all() as Array<{
        key: string;
        value: string;
      }>,
  });

  const loggers = createServerLoggers();
  const ctx = createContext(db, hooks, {
    auth,
    profiles,
    settingsFile,
    log: loggers,
  });

  const app = buildApp(ctx);

  if (staticDir) {
    const staticRoot = resolve(staticDir);
    const indexHtml = join(staticRoot, "index.html");
    app.use("/*", serveStatic({ root: staticRoot }));
    // SPA fallback: unknown routes serve index.html.
    app.get("*", async (c) => {
      const html = await readFile(indexHtml, "utf8");
      return c.html(html);
    });
  }

  const wss = new WebSocketServer({ noServer: true });

  return await new Promise<SaktiServer>((resolveReady) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname,
        port,
        websocket: { server: wss as unknown as WebSocketServerLike },
      },
      (info) => {
        // Fires once the OS has bound the socket (port:0 now resolved).
        resolveReady({
          hostname: info.address,
          port: info.port,
          url: `http://${info.address}:${info.port}`,
          stop: () =>
            new Promise<void>((resolveStop) => {
              server.close(() => resolveStop());
            }),
        });
      }
    );
  });
}
