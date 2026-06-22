import {
  type DrizzleDB,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
  SqliteSessionStorage,
} from "@sakti-code/db";
import type { Context } from "hono";
import type { ServerHooks } from "./create-server.ts";
import { factory } from "./factory.ts";
import type { ApiKeyStore } from "./lib/api-key-store.ts";
import { TerminalManager } from "./terminal/terminal-manager.ts";

export interface ServerContext {
  apiKeys: ApiKeyStore;
  db: DrizzleDB;
  hooks: ServerHooks;
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    settings: SettingsRepo;
    models: ModelConfigRepo;
  };
  terminalManager: TerminalManager;
}

export function createContext(
  db: DrizzleDB,
  hooks: ServerHooks,
  apiKeys: ApiKeyStore
): ServerContext {
  return {
    apiKeys,
    db,
    hooks,
    repos: {
      projects: new ProjectRepo(db),
      sessions: new SessionRepo(db),
      settings: new SettingsRepo(db),
      models: new ModelConfigRepo(db),
    },
    terminalManager: new TerminalManager(),
  };
}

export function createSessionStorage(
  ctx: ServerContext,
  sessionId: string
): SqliteSessionStorage {
  const session = ctx.repos.sessions.findById(sessionId);
  return new SqliteSessionStorage(ctx.db, sessionId, {
    id: sessionId,
    createdAt: session
      ? new Date(session.createdAt).toISOString()
      : new Date().toISOString(),
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
