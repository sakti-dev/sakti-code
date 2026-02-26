export { runEventsRoutes } from "./run-events.route.js";
export { taskRunsRoutes } from "./task-runs.route.js";

export const migrationCheckpoint = {
  task: "Wire task-runs module routes",
  status: "implemented-minimally",
} as const;
