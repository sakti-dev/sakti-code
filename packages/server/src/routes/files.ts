/**
 * Files API Routes
 *
 * GET /api/files/search - Search files in project index
 * GET /api/files/status - Get file watcher status
 * POST /api/files/watch - Start watching a directory
 * DELETE /api/files/watch - Stop watching a directory
 */

import { Hono } from "hono";
import { z } from "zod";
import { fileIndex } from "../services/file-index";
import { fileWatcher } from "../services/file-watcher";
import { zValidator } from "../shared/controller/http/validators.js";

const filesRouter = new Hono();

const searchQuerySchema = z.object({
  directory: z.string().min(1),
  query: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(20),
});

const statusQuerySchema = z.object({
  directory: z.string().optional(),
});

const watchBodySchema = z.object({
  directory: z.string().min(1),
});

filesRouter.get("/api/files/search", zValidator("query", searchQuerySchema), async c => {
  const { directory, query, limit } = c.req.valid("query");

  // Lazily bootstrap file indexing on first search for this directory.
  // This ensures context search works after app restart without a separate watch call.
  if (!fileIndex.hasIndex(directory)) {
    try {
      await fileWatcher.watch(directory);
    } catch (error) {
      return c.json(
        {
          error: "Failed to initialize file index",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  }

  const results = fileIndex.search(directory, query, limit);

  return c.json({
    files: results,
    query,
    directory,
    count: results.length,
  });
});

filesRouter.get("/api/files/status", zValidator("query", statusQuerySchema), async c => {
  const { directory } = c.req.valid("query");
  if (!directory) {
    return c.json({
      watchers: [],
    });
  }

  return c.json({
    directory,
    watching: fileWatcher.isWatching(directory),
    indexed: fileIndex.hasIndex(directory),
  });
});

filesRouter.post("/api/files/watch", zValidator("json", watchBodySchema), async c => {
  const { directory } = c.req.valid("json");

  try {
    await fileWatcher.watch(directory);
    return c.json({
      success: true,
      directory,
      message: "Now watching for file changes",
    });
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

filesRouter.delete("/api/files/watch", zValidator("json", watchBodySchema), async c => {
  const { directory } = c.req.valid("json");

  try {
    await fileWatcher.unwatch(directory);
    return c.json({
      success: true,
      directory,
      message: "Stopped watching",
    });
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
