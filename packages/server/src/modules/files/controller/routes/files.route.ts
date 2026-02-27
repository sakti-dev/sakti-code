import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import {
  getFileStatus,
  searchFiles,
  unwatchDirectory,
  watchDirectory,
} from "../../application/usecases/search-files.usecase.js";

const filesRouter = new Hono<Env>();

const searchQuerySchema = z.object({
  directory: z.string().min(1),
  query: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(20),
});

filesRouter.get("/api/files/search", zValidator("query", searchQuerySchema), async c => {
  const { directory, query, limit } = c.req.valid("query");

  try {
    const result = await searchFiles({ directory, query, limit });
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error: "Failed to search files",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

const statusQuerySchema = z.object({
  directory: z.string().optional(),
});

filesRouter.get("/api/files/status", zValidator("query", statusQuerySchema), async c => {
  const { directory } = c.req.valid("query");

  if (!directory) {
    return c.json({
      watchers: [],
    });
  }

  const status = getFileStatus(directory);
  return c.json(status);
});

const WatchBodySchema = z.object({
  directory: z.string(),
});

filesRouter.post("/api/files/watch", zValidator("json", WatchBodySchema), async c => {
  try {
    const body = c.req.valid("json");
    const result = await watchDirectory(body);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error: "Failed to start watcher",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

filesRouter.delete("/api/files/watch", zValidator("json", WatchBodySchema), async c => {
  try {
    const body = c.req.valid("json");
    const result = await unwatchDirectory(body);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error: "Failed to stop watcher",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default filesRouter;
