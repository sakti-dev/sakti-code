import { app } from "./app.js";

export type AppType = typeof app;

export const migrationCheckpoint = {
  task: "Export final AppType",
  status: "implemented-minimally",
} as const;
