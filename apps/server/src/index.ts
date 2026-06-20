import { Database } from "bun:sqlite";
import { type DrizzleDB, initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { createContext } from "./context.ts";
import { availableModelsRoutes } from "./routes/available-models.ts";
import { costsRoutes } from "./routes/costs.ts";
import { healthRoutes } from "./routes/health.ts";
import { modelConfigRoutes } from "./routes/models.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { sessionsRoutes } from "./routes/sessions.ts";
import { settingsRoutes } from "./routes/settings.ts";

// biome-ignore lint/suspicious/noExplicitAny: Elysia plugin composition requires erasing generics
type AnyElysia = Elysia<any, any, any, any, any, any, any>;

const foundationRoutes = [
  healthRoutes,
  projectsRoutes,
  sessionsRoutes,
  settingsRoutes,
  modelConfigRoutes,
  costsRoutes,
  availableModelsRoutes,
];

export function buildServer({
  db,
  routes,
}: {
  db: DrizzleDB;
  routes?: AnyElysia[];
}) {
  const app = [...foundationRoutes, ...(routes ?? [])].reduce(
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
