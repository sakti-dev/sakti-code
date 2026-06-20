import {
  CostRepo,
  type DrizzleDB,
  MessageRepo,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "@sakti-code/db";
import { TerminalManager } from "./terminal/terminal-manager.ts";

export interface ServerContext {
  db: DrizzleDB;
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    messages: MessageRepo;
    costs: CostRepo;
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
      messages: new MessageRepo(db),
      costs: new CostRepo(db),
      settings: new SettingsRepo(db),
      models: new ModelConfigRepo(db),
    },
    terminalManager: new TerminalManager(),
  };
}

/** Extract typed ServerContext from Elysia store. */
export function getCtx(store: { ctx?: ServerContext }): ServerContext {
  if (!store.ctx) {
    throw new Error("ServerContext not injected");
  }
  return store.ctx;
}
