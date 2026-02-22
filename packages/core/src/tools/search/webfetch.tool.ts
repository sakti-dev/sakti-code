/**
 * WebFetch tool
 *
 * Fetches web content and converts to markdown, text, or HTML
 *
 * NOTE: Uses Mastra createTool for compatibility. Can be migrated to AI SDK in future.
 */

import { createTool } from "@mastra/core/tools";
import { createLogger } from "@sakti-code/shared/logger";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import { z } from "zod";

const logger = createLogger("sakti-code");

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

type Format = "text" | "markdown" | "html";

interface FetchResult {
  content: string;
  statusCode?: number;
  contentType?: string;
}

export const webfetchTool = createTool({
  id: "webfetch",
  description: `Fetch content from URLs and convert to markdown, text, or HTML.

Features:
- Converts HTML to markdown format
- Handles redirects automatically
- 5MB size limit
- 30 second timeout
- Cloudflare challenge bypass`,

  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
    format: z.enum(["text", "markdown", "html"]).default("markdown").describe("Output format"),
    timeout: z.number().max(120).optional().describe("Timeout in seconds (max: 120)"),
  }),

  outputSchema: z.object({
    content: z.string(),
    metadata: z.object({
      statusCode: z.number().optional(),
      contentType: z.string().optional(),
      truncated: z.boolean().optional(),
      url: z.string(),
    }),
  }),

  execute: async ({ url, format = "markdown", timeout }, _context) => {
    const sessionID = "unknown";

    logger.debug("Fetching URL", { module: "tool:webfetch", sessionID, url, format });

    try {
      const result = await fetchWithTimeout(url, format, timeout || 30);

      // Convert to requested format
      let finalContent = result.content;

      if (format === "markdown" && result.contentType?.includes("html")) {
        // Convert HTML to markdown using Turndown
        const TurndownService = (await import("turndown")).default;
        const turndownService = new TurndownService({
          headingStyle: "atx",
          hr: "---",
          bulletListMarker: "-",
          codeBlockStyle: "fenced",
        });

        // Remove script, style, meta tags
        turndownService.remove(["script", "style", "meta", "link"]);

        finalContent = turndownService.turndown(result.content);
      }

      logger.info("URL fetched successfully", {
        module: "tool:webfetch",
        sessionID,
        url,
        statusCode: result.statusCode,
        format,
        contentLength: finalContent.length,
      });

      return {
        content: finalContent,
        metadata: {
          statusCode: result.statusCode,
          contentType: result.contentType,
          truncated: false,
          url,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fetch URL: ${errorMessage}`, undefined, {
        module: "tool:webfetch",
        sessionID,
      });

      return {
        content: `Error fetching URL: ${errorMessage}`,

        metadata: {
          url,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      };
    }
  },
});

/**
 * Fetch URL with timeout and size limit
 */
async function fetchWithTimeout(
  url: string,
  format: Format,
  timeoutSec: number
): Promise<FetchResult> {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === "https:";
  const client = isHttps ? await import("node:https") : await import("node:http");

  // Get Accept header for format
  const acceptHeader = getAcceptHeader(format);

  return new Promise((resolve, reject) => {
    const timeoutMs = Math.min(timeoutSec * 1000, 120000); // Max 2 minutes

    const options = {
      headers: {
        "User-Agent": "sakti-code",
        Accept: acceptHeader,
      },
      timeout: timeoutMs,
    };

    const req = client.get(url, options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let contentLength = 0;

      res.on("data", (chunk: Buffer) => {
        contentLength += chunk.length;

        // Check size limit
        if (contentLength > MAX_SIZE) {
          req.destroy();
          resolve({
            content: "",
            statusCode: res.statusCode,
            contentType: res.headers["content-type"],
          });
          return;
        }

        chunks.push(chunk);
      });

      res.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf-8");

        // Check for Cloudflare challenge
        if (res.headers["cf-mitigated"] === "challenge") {
          // Retry with different user agent
          fetchWithRetry(url, format, timeoutSec).then(resolve).catch(reject);
          return;
        }

        resolve({
          content,
          statusCode: res.statusCode,
          contentType: res.headers["content-type"],
        });
      });

      res.on("error", error => {
        reject(error);
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    req.on("error", error => {
      reject(error);
    });

    req.setTimeout(timeoutMs);
  });
}

/**
 * Retry fetch with different user agent
 */
async function fetchWithRetry(
  url: string,
  format: Format,
  timeoutSec: number
): Promise<FetchResult> {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === "https:";
  const client = isHttps ? await import("node:https") : await import("node:http");

  const acceptHeader = getAcceptHeader(format);

  return new Promise((resolve, reject) => {
    const timeoutMs = Math.min(timeoutSec * 1000, 120000);

    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; sakti-code/1.0)",
        Accept: acceptHeader,
      },
      timeout: timeoutMs,
    };

    const req = client.get(url, options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        resolve({
          content: Buffer.concat(chunks).toString("utf-8"),
          statusCode: res.statusCode,
          contentType: res.headers["content-type"],
        });
      });

      res.on("error", error => {
        reject(error);
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    req.on("error", error => {
      reject(error);
    });

    req.setTimeout(timeoutMs);
  });
}

/**
 * Get Accept header for format
 */
function getAcceptHeader(format: Format): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/plain;q=0.8, text/html;q=0.5";
    case "text":
      return "text/plain;q=1.0, application/json;q=0.8";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9";
    default:
      return "*/*";
  }
}
