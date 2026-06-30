import {
  type DrizzleDB,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
  SqliteSessionStorage,
  TurnRepo,
} from "@sakti-code/db";
import type { Context } from "hono";
import type { ServerHooks } from "./create-server.ts";
import { factory } from "./factory.ts";
import type { AuthStore } from "./lib/auth-store.ts";
import type { ServerLoggers } from "./lib/loggers.ts";
import type { ProfilesStore } from "./lib/profiles-store.ts";
import type { SettingsFileStore } from "./lib/settings-file-store.ts";
import { TerminalManager } from "./terminal/terminal-manager.ts";

export interface ServerContext {
  auth: AuthStore;
  db: DrizzleDB;
  hooks: ServerHooks;
  /** Per-layer file loggers (server/agent/tools/llm). Optional: absent in tests / when logging is disabled. */
  log?: ServerLoggers;
  profiles: ProfilesStore;
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    settings: SettingsRepo;
    turns: TurnRepo;
  };
  settingsFile: SettingsFileStore;
  terminalManager: TerminalManager;
}

export function createContext(
  db: DrizzleDB,
  hooks: ServerHooks,
  deps: {
    auth: AuthStore;
    profiles: ProfilesStore;
    settingsFile: SettingsFileStore;
    log?: ServerLoggers;
  },
): ServerContext {
  return {
    auth: deps.auth,
    db,
    hooks,
    ...(deps.log === undefined ? {} : { log: deps.log }),
    profiles: deps.profiles,
    repos: {
      projects: new ProjectRepo(db),
      sessions: new SessionRepo(db),
      settings: new SettingsRepo(db),
      turns: new TurnRepo(db),
    },
    settingsFile: deps.settingsFile,
    terminalManager: new TerminalManager(),
  };
}

export function createSessionStorage(ctx: ServerContext, sessionId: string): SqliteSessionStorage {
  const session = ctx.repos.sessions.findById(sessionId);
  return new SqliteSessionStorage(ctx.db, sessionId, {
    id: sessionId,
    createdAt: session ? new Date(session.createdAt).toISOString() : new Date().toISOString(),
  });
}

/** Middleware that injects ServerContext into c.var.ctx for all downstream routes. */
export function ctxMiddleware(ctx: ServerContext) {
  return factory.createMiddleware(async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
}

/** Read the injected ServerContext from a Hono context. */
export function getCtx(c: Context): ServerContext {
  const ctx = c.get("ctx") as ServerContext | undefined;
  if (!ctx) {
    throw new Error("ServerContext not injected");
  }
  return ctx;
}
