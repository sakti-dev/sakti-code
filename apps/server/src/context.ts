import {
  CostRepo,
  type DrizzleDB,
  MessageRepo,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "@sakti-code/db";

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
  };
}

/** Extract typed ServerContext from Elysia store. */
export function getCtx(store: { ctx?: ServerContext }): ServerContext {
  if (!store.ctx) {
    throw new Error("ServerContext not injected");
  }
  return store.ctx;
}
