import { Database } from "bun:sqlite";
import { type DrizzleDB, initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { buildWsApp } from "./agent/ws.ts";
import { createContext } from "./context.ts";
import { healthRoutes } from "./routes/health.ts";
import { availableModelsRoutes } from "./routes/models/available-models.ts";
import { modelConfigRoutes } from "./routes/models/models.ts";
import { gitRoutes } from "./routes/projects/git.ts";
import { projectsRoutes } from "./routes/projects/projects.ts";
import { searchFilesRoutes } from "./routes/projects/search-files.ts";
import { bashRoutes } from "./routes/sessions/bash.ts";
import { compactionRoutes } from "./routes/sessions/compaction.ts";
import { exportRoutes } from "./routes/sessions/export.ts";
import { forkingRoutes } from "./routes/sessions/forking.ts";
import { lastAssistantTextRoutes } from "./routes/sessions/last-assistant-text.ts";
import { sessionSettingsRoutes } from "./routes/sessions/session-settings.ts";
import { sessionsRoutes } from "./routes/sessions/sessions.ts";
import { statsRoutes } from "./routes/sessions/stats.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { terminalRoutes } from "./routes/workspace/terminals.ts";
import { workspaceRoutes } from "./routes/workspace/workspace.ts";

// biome-ignore lint/suspicious/noExplicitAny: Elysia plugin composition requires erasing generics
type AnyElysia = Elysia<any, any, any, any, any, any, any>;

// All route modules are composed into the default server so feature endpoints
// actually serve in production (previously each was imported only by its own
// test, leaving them 404 in the booted server).
const defaultRoutes = [
  healthRoutes,
  projectsRoutes,
  sessionsRoutes,
  settingsRoutes,
  modelConfigRoutes,
  availableModelsRoutes,
  searchFilesRoutes,
  workspaceRoutes,
  lastAssistantTextRoutes,
  compactionRoutes,
  statsRoutes,
  gitRoutes,
  bashRoutes,
  terminalRoutes,
  forkingRoutes,
  exportRoutes,
  sessionSettingsRoutes,
  buildWsApp(),
];

export function buildServer({
  db,
  routes,
}: {
  db: DrizzleDB;
  routes?: AnyElysia[];
}) {
  const app = [...defaultRoutes, ...(routes ?? [])].reduce(
    (a, route) => a.use(route as typeof a),
    new Elysia().state("ctx", createContext(db))
  );
  app.compile();
  return app;
}

export type App = ReturnType<typeof buildServer>;

if (import.meta.main) {
  const dbPath = process.env.SAKTI_DB_PATH ?? "sakti.db";
  const db = await initDatabase(new Database(dbPath));
  const app = buildServer({ db });
  app.listen(Number(process.env.SAKTI_PORT ?? 3001));
  console.log(
    `sakti-code server on http://localhost:${process.env.SAKTI_PORT ?? 3001}`
  );
}
