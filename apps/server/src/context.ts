import {
  type DrizzleDB,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
  SqliteSessionStorage,
} from "@sakti-code/db";
import { TerminalManager } from "./terminal/terminal-manager.ts";

export interface ServerContext {
  db: DrizzleDB;
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    settings: SettingsRepo;
    models: ModelConfigRepo;
  };
  terminalManager: TerminalManager;
}

export function createContext(db: DrizzleDB): ServerContext {
  return {
    db,
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

/** Extract typed ServerContext from Elysia store. */
export function getCtx(store: { ctx?: ServerContext }): ServerContext {
  if (!store.ctx) {
    throw new Error("ServerContext not injected");
  }
  return store.ctx;
}
