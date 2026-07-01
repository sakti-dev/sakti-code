import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const ZAI_MCP_URL = "https://api.z.ai/api/mcp/web_search_prime/mcp";
export const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_LOCATION = "us";
const PROTOCOL_VERSION = "2024-11-05";

interface ZaiRow {
  title?: string;
  link?: string;
  content?: string;
  refer?: string;
}

/** Read the first `data:` line (no space after colon, per z.ai's format) and parse it. */
function parseSseJson(body: string): unknown {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractContentText(parsed: unknown): string | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const result = (parsed as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0] as { text?: string } | undefined;
  return first?.text;
}

function baseHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
}

async function initialize(apiKey: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(ZAI_MCP_URL, {
    method: "POST",
    headers: baseHeaders(apiKey),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "sakti", version: "0.0.0" },
      },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`z.ai initialize HTTP ${response.status}`);
  // Drain the SSE body so the connection releases; we only need the header.
  await (response.body
    ? collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
    : Promise.resolve(new Uint8Array()));
  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("z.ai MCP did not return a session id");
  return sessionId;
}

export function buildZaiOperations(apiKey: string): SearchOperations {
  return {
    async search(query, opts) {
      const sessionId = await initialize(apiKey, opts.signal);
      const response = await fetch(ZAI_MCP_URL, {
        method: "POST",
        headers: { ...baseHeaders(apiKey), "Mcp-Session-Id": sessionId },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "web_search_prime",
            arguments: {
              search_query: query,
              content_size: "medium",
              location: DEFAULT_LOCATION,
            },
          },
        }),
        signal: opts.signal,
      });
      if (!response.ok) throw new Error(`z.ai HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      const text = extractContentText(parseSseJson(new TextDecoder().decode(bytes))) ?? "[]";
      let rows: ZaiRow[] = [];
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) rows = parsed as ZaiRow[];
      } catch {
        rows = [];
      }
      const results: SearchResult[] = rows.map((r) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        snippet: r.content ?? "",
      }));
      return { provider: "zai", results: results.slice(0, opts.numResults) };
    },
  };
}
