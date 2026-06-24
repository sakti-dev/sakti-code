import { buildWsApp } from "./agent/ws.ts";
import { ctxMiddleware, type ServerContext } from "./context.ts";
import { factory } from "./factory.ts";
import { authRoutes } from "./routes/auth.ts";
import { dialogRoutes } from "./routes/dialog.ts";
import { healthRoutes } from "./routes/health.ts";
import { availableModelsRoutes } from "./routes/models/available-models.ts";
import { profilesRoutes } from "./routes/profiles.ts";
import { gitRoutes } from "./routes/projects/git.ts";
import { intakeSessionRoutes } from "./routes/projects/intake-session.ts";
import { projectsRoutes } from "./routes/projects/projects.ts";
import { searchFilesRoutes } from "./routes/projects/search-files.ts";
import { compactionRoutes } from "./routes/sessions/compaction.ts";
import { exportRoutes } from "./routes/sessions/export.ts";
import { forkingRoutes } from "./routes/sessions/forking.ts";
import { lastAssistantTextRoutes } from "./routes/sessions/last-assistant-text.ts";
import { sessionSettingsRoutes } from "./routes/sessions/session-settings.ts";
import { sessionsRoutes } from "./routes/sessions/sessions.ts";
import { statsRoutes } from "./routes/sessions/stats.ts";
import { turnsRoutes } from "./routes/sessions/turns.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { terminalRoutes } from "./routes/workspace/terminals.ts";
import { workspaceRoutes } from "./routes/workspace/workspace.ts";

export function buildApp(ctx: ServerContext) {
  const rest = factory
    .createApp()
    .route("/", healthRoutes)
    .route("/", projectsRoutes)
    .route("/", intakeSessionRoutes)
    .route("/", gitRoutes)
    .route("/", searchFilesRoutes)
    .route("/", sessionsRoutes)
    .route("/", compactionRoutes)
    .route("/", statsRoutes)
    .route("/", turnsRoutes)
    .route("/", forkingRoutes)
    .route("/", exportRoutes)
    .route("/", lastAssistantTextRoutes)
    .route("/", sessionSettingsRoutes)
    .route("/", settingsRoutes)
    .route("/", profilesRoutes)
    .route("/", availableModelsRoutes)
    .route("/", authRoutes)
    .route("/", workspaceRoutes)
    .route("/", terminalRoutes)
    .route("/", dialogRoutes);

  return factory
    .createApp()
    .use(ctxMiddleware(ctx))
    .route("/api", rest)
    .route("/", buildWsApp(ctx));
}

export type App = ReturnType<typeof buildApp>;
