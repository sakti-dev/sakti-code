/**
 * LSP API Routes
 *
 * GET /api/lsp/status - Get LSP server status
 */

import { Hono } from "hono";
import type { Env } from "../index";

const lspRouter = new Hono<Env>();

/**
 * Get LSP server status
 */
lspRouter.get("/api/lsp/status", async c => {
  const directory = c.req.query("directory") || c.get("instanceContext")?.directory;

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
