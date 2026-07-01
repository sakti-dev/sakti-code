import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { formatSize, truncateHead, type TruncationResult } from "../lib/truncate.ts";

export const DEFAULT_NUM_RESULTS = 8;
export const MAX_NUM_RESULTS = 20;
export const DEFAULT_TIMEOUT_SECONDS = 25;
export const NO_RESULTS_NOTICE = "No search results found. Try a different query.";

const websearchSchema = Type.Object({
  query: Type.String({ description: "The search query" }),
  numResults: Type.Optional(
    Type.Number({
      description: `Number of results (default ${DEFAULT_NUM_RESULTS}, max ${MAX_NUM_RESULTS}).`,
    }),
  ),
});

export type WebSearchToolInput = Static<typeof websearchSchema>;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOperations {
  search(
    query: string,
    opts: { numResults: number; signal: AbortSignal },
  ): Promise<{ provider: string; results: SearchResult[] }>;
}

export interface WebSearchToolDetails {
  provider: string;
  query: string;
  count: number;
  truncation?: TruncationResult;
}

export interface WebSearchToolOptions {
  operations?: SearchOperations;
}

function clampNumResults(n: number | undefined): number {
  const value = Math.trunc(n ?? DEFAULT_NUM_RESULTS);
  if (value < 1) return 1;
  if (value > MAX_NUM_RESULTS) return MAX_NUM_RESULTS;
  return value;
}

function renderResults(results: SearchResult[]): string {
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
}

export function createWebSearchTool(
  options?: WebSearchToolOptions,
): AgentTool<typeof websearchSchema, WebSearchToolDetails> {
  return {
    name: "websearch",
    label: "websearch",
    description: `Search the web and return a list of results (title, URL, snippet). Read-only. Defaults to ${DEFAULT_NUM_RESULTS} results (max ${MAX_NUM_RESULTS}); times out after ${DEFAULT_TIMEOUT_SECONDS}s. Follow up with \`webfetch\` for full page content. Useful for current information beyond the model's knowledge cutoff.`,
    parameters: websearchSchema,
    permissions: (params) => [
      { permission: "websearch", patterns: [(params as WebSearchToolInput).query] },
    ],
    async execute(_toolCallId, input, signal) {
      const operations = options?.operations;
      if (!operations) {
        throw new Error(
          "Web search is not available — no search provider is configured. Ask the user to set up a web search provider (Exa or Tavily) with an API key in the app settings, then retry.",
        );
      }
      const query = (input.query ?? "").trim();
      if (!query) throw new Error("query must be a non-empty string");
      const numResults = clampNumResults(input.numResults);

      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      if (signal) {
        if (signal.aborted) throw new Error("Operation aborted");
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SECONDS * 1000);

      let provider: string;
      let results: SearchResult[];
      try {
        try {
          const out = await operations.search(query, { numResults, signal: controller.signal });
          provider = out.provider;
          results = out.results;
        } catch (error) {
          if (signal?.aborted) throw new Error("Operation aborted");
          if (controller.signal.aborted) throw new Error("Web search timed out");
          throw error;
        }
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onExternalAbort);
      }

      const count = results.length;
      const details: WebSearchToolDetails = { provider, query, count };
      const body = count === 0 ? NO_RESULTS_NOTICE : renderResults(results);
      const truncation = truncateHead(body);
      const notices: string[] = [];
      if (truncation.truncated) {
        details.truncation = truncation;
        notices.push(`${formatSize(truncation.maxBytes)} limit reached`);
      }
      const text =
        notices.length > 0
          ? `${truncation.content}\n\n[${notices.join(". ")}]`
          : truncation.content;
      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  };
}
