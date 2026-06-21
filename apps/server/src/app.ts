import { Elysia } from "elysia";
import { buildWsApp } from "./agent/ws.ts";
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

export const app = new Elysia({ prefix: "/api" })
  .use(healthRoutes)
  .use(projectsRoutes)
  .use(sessionsRoutes)
  .use(settingsRoutes)
  .use(modelConfigRoutes)
  .use(availableModelsRoutes)
  .use(searchFilesRoutes)
  .use(workspaceRoutes)
  .use(lastAssistantTextRoutes)
  .use(compactionRoutes)
  .use(statsRoutes)
  .use(gitRoutes)
  .use(bashRoutes)
  .use(terminalRoutes)
  .use(forkingRoutes)
  .use(exportRoutes)
  .use(sessionSettingsRoutes)
  .use(buildWsApp());

export type App = typeof app;
