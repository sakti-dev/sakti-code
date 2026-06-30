import { Parser } from "htmlparser2";
import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const DDG_URL = "https://lite.duckduckgo.com/lite/";
export const MAX_RESPONSE_BYTES = 512 * 1024;

export function parseDdgHtml(html: string, max: number): SearchResult[] {
  const collected: SearchResult[] = [];
  let current: { title: string; url: string; snippet: string } | null = null;
  let inLink = false;
  let inSnippet = false;

  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === "a" && attribs.class === "result-link") {
        inLink = true;
        current = { title: "", url: attribs.href ?? "", snippet: "" };
      } else if (name === "td" && attribs.class === "result-snippet") {
        inSnippet = true;
      }
    },
    ontext(text) {
      if (inLink && current) {
        current.title += text;
      } else if (inSnippet && current) {
        current.snippet += text;
      }
    },
    onclosetag(name) {
      if (name === "a" && inLink) {
        inLink = false;
      } else if (name === "td" && inSnippet) {
        inSnippet = false;
        if (current && current.url && current.title.trim()) {
          collected.push({
            title: current.title.trim(),
            url: current.url,
            snippet: current.snippet.trim(),
          });
        }
        current = null;
      }
    },
  });
  parser.write(html);
  parser.end();

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const r of collected) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    results.push(r);
    if (results.length >= max) break;
  }
  return results;
}

export function buildDdgOperations(): SearchOperations {
  return {
    async search(query, opts) {
      const url = `${DDG_URL}?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { signal: opts.signal });
      if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      return {
        provider: "ddg",
        results: parseDdgHtml(new TextDecoder().decode(bytes), opts.numResults),
      };
    },
  };
}
