import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const MAX_RESPONSE_BYTES = 256 * 1024;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

interface ExaStructured {
  title?: string;
  url?: string;
  text?: string;
}

function exaUrl(apiKey: string): string {
  const url = new URL(EXA_MCP_URL);
  url.searchParams.set("exaApiKey", apiKey);
  return url.toString();
}

function parsePayload(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { result?: { content?: { text?: string }[] } };
    return parsed.result?.content?.find((item) => item.text)?.text;
  } catch {
    return undefined;
  }
}

function parseResponse(body: string): string | undefined {
  const direct = parsePayload(body);
  if (direct) return direct;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = parsePayload(line.slice(6));
    if (data) return data;
  }
  return undefined;
}

function mapToResults(text: string): SearchResult[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (Array.isArray(arr)) {
      return arr
        .filter((r): r is ExaStructured => typeof r === "object" && r !== null)
        .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.text ?? "" }));
    }
  } catch {
    // not JSON — treat as a context blob
  }
  return text ? [{ title: "Exa", url: "", snippet: text }] : [];
}

export function buildExaOperations(apiKey: string): SearchOperations {
  return {
    async search(query, opts) {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: { query, type: "auto", numResults: opts.numResults, livecrawl: "fallback" },
        },
      });
      const response = await fetch(exaUrl(apiKey), {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
        body,
        signal: opts.signal,
      });
      if (!response.ok) throw new Error(`Exa HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      const payload = parseResponse(new TextDecoder().decode(bytes)) ?? "";
      return { provider: "exa", results: mapToResults(payload) };
    },
  };
}
