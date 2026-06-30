import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const TAVILY_URL = "https://api.tavily.com/search";
export const MAX_RESPONSE_BYTES = 256 * 1024;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export function buildTavilyOperations(apiKey: string): SearchOperations {
  return {
    async search(query, opts) {
      const response = await fetch(TAVILY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, max_results: opts.numResults, include_answer: false }),
        signal: opts.signal,
      });
      if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { results?: TavilyResult[] };
      const results: SearchResult[] = (parsed.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));
      return { provider: "tavily", results };
    },
  };
}
