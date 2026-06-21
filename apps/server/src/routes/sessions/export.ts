import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia } from "elysia";
import { getCtx } from "../../context.ts";

function renderHtmlExport(
  sessionTitle: string | null,
  projectName: string,
  sessionCreatedAt: number,
  messages: Array<{ role: string; content: string; createdAt: number }>
): string {
  const title = sessionTitle || "Session Export";
  const date = new Date(sessionCreatedAt).toISOString().slice(0, 10);

  const messageHtml = messages
    .map((m) => {
      let roleClass: string;
      if (m.role === "user") {
        roleClass = "user";
      } else if (m.role === "assistant") {
        roleClass = "assistant";
      } else {
        roleClass = "tool";
      }
      const dateStr = new Date(m.createdAt).toLocaleString();
      const collapsed = m.role === "tool" ? " collapsed" : "";
      const copyBtn =
        m.role === "assistant"
          ? `<button class="copy-btn" type="button">Copy</button>`
          : "";

      return `
        <div class="message ${roleClass}">
          <div class="meta">${m.role} &middot; ${dateStr}</div>
          <div class="bubble${collapsed}">
            ${copyBtn}<pre>${escapeHtml(m.content.slice(0, 2000))}</pre>
          </div>
        </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 800px; margin: 0 auto; padding: 20px;
    background: #f5f5f5; color: #333; line-height: 1.6;
  }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
  .message { margin-bottom: 16px; display: flex; flex-direction: column; }
  .message.user { align-items: flex-end; }
  .message.assistant { align-items: flex-start; }
  .message.tool { align-items: flex-start; opacity: 0.7; }
  .meta { font-size: 0.75rem; color: #999; margin-bottom: 4px; padding: 0 4px; }
  .bubble {
    max-width: 80%; padding: 12px 16px; border-radius: 12px;
    background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    position: relative;
  }
  .bubble.user { background: #007aff; color: #fff; }
  .bubble pre {
    white-space: pre-wrap; word-break: break-word;
    font-family: inherit; font-size: inherit;
  }
  .bubble.tool pre { font-size: 0.85rem; color: #666; }
  .bubble.collapsed { max-height: 80px; overflow: hidden; position: relative; }
  .bubble.collapsed::after {
    content: ''; position: absolute; bottom: 0; left: 0; right: 0;
    height: 40px; background: linear-gradient(transparent, #fff);
  }
  .bubble.user.collapsed::after { background: linear-gradient(transparent, #007aff); }
  .copy-btn {
    position: absolute; top: 4px; right: 4px;
    background: rgba(0,0,0,0.1); border: none; border-radius: 4px;
    padding: 2px 8px; font-size: 0.75rem; cursor: pointer;
    opacity: 0; transition: opacity 0.2s;
  }
  .bubble:hover .copy-btn { opacity: 1; }
  @media (max-width: 600px) {
    body { padding: 10px; }
    .bubble { max-width: 90%; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(projectName)} &middot; ${date}</div>
  ${messageHtml || "<p style='color: #999;'>No messages in this session.</p>"}
  <script>
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = btn.parentElement.querySelector('pre');
        navigator.clipboard.writeText(pre.textContent);
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export const exportRoutes = new Elysia({ name: "routes.export" }).get(
  "/api/sessions/:id/export-html",
  async ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const project = ctx.repos.projects.findById(session.projectId);
    const projectName = project?.name ?? "Unknown";

    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date(session.createdAt).toISOString(),
    });
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages: agentMessages } = buildSessionContext(entries);

    const messagesData = agentMessages.map((m) => ({
      role: m.role,
      content: flattenContent((m as { content: unknown }).content),
      createdAt: (m as { timestamp: number }).timestamp ?? session.createdAt,
    }));

    const html = renderHtmlExport(
      session.title,
      projectName,
      session.createdAt,
      messagesData
    );

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
);
