import { Database } from "bun:sqlite";
import { type DrizzleDB, initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { buildWsApp } from "./agent/ws.ts";
import { createContext } from "./context.ts";
import { availableModelsRoutes } from "./routes/available-models.ts";
import { bashRoutes } from "./routes/bash.ts";
import { commandsRoutes } from "./routes/commands.ts";
import { compactionRoutes } from "./routes/compaction.ts";
import { costsRoutes } from "./routes/costs.ts";
import { exportRoutes } from "./routes/export.ts";
import { forkingRoutes } from "./routes/forking.ts";
import { gitRoutes } from "./routes/git.ts";
import { healthRoutes } from "./routes/health.ts";
import { lastAssistantTextRoutes } from "./routes/last-assistant-text.ts";
import { modelConfigRoutes } from "./routes/models.ts";
import { namingRoutes } from "./routes/naming.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { searchFilesRoutes } from "./routes/search-files.ts";
import { sessionControlRoutes } from "./routes/session-controls.ts";
import { sessionSettingsRoutes } from "./routes/session-settings.ts";
import { sessionsRoutes } from "./routes/sessions.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { statsRoutes } from "./routes/stats.ts";
import { terminalRoutes } from "./routes/terminals.ts";
import { turnDiffRoutes } from "./routes/turn-diff.ts";
import { workspaceRoutes } from "./routes/workspace.ts";

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
  costsRoutes,
  availableModelsRoutes,
  commandsRoutes,
  searchFilesRoutes,
  turnDiffRoutes,
  workspaceRoutes,
  lastAssistantTextRoutes,
  compactionRoutes,
  statsRoutes,
  gitRoutes,
  bashRoutes,
  terminalRoutes,
  forkingRoutes,
  namingRoutes,
  exportRoutes,
  sessionSettingsRoutes,
  sessionControlRoutes,
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
