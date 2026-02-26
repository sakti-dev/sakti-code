/**
 * LSP API Routes
 *
 * GET /api/lsp/status - Get LSP server status
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { zValidator } from "../shared/controller/http/validators.js";

const lspRouter = new Hono<Env>();
const lspQuerySchema = z.object({
  directory: z.string().optional(),
});

/**
 * Get LSP server status
 */
lspRouter.get("/api/lsp/status", zValidator("query", lspQuerySchema), async c => {
  const directory = c.req.valid("query").directory || c.get("instanceContext")?.directory;

  let servers: Array<{ id: string; name: string; root: string; status: string }> = [];

  try {
    const { LSP } = await import("@sakti-code/core");
    const status = LSP.getStatus();
    servers = status.map((s: { id: string; name: string; root: string; status: string }) => ({
      id: s.id,
      name: s.name,
      root: s.root,
      status: s.status,
    }));
  } catch {
    // Core LSP not available, return empty servers
  }

  return c.json({
    servers,
    directory,
  });
});

export default lspRouter;
