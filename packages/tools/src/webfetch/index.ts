import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { convertHTMLToMarkdown, extractTextFromHTML } from "../lib/html-convert.ts";
import { formatSize, truncateHead, type TruncationResult } from "../lib/truncate.ts";
import { collectBoundedBody } from "./bounded-body.ts";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

type Format = "text" | "markdown" | "html";

const webfetchSchema = Type.Object({
  url: Type.String({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("html")], {
      description: "Format to return content in: text, markdown, or html. Defaults to markdown.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS}). Defaults to ${DEFAULT_TIMEOUT_SECONDS}.`,
    }),
  ),
});

export type WebFetchToolInput = Static<typeof webfetchSchema>;

export interface WebFetchToolDetails {
  url: string;
  contentType: string;
  format: Format;
  truncation?: TruncationResult;
}

export interface WebFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bytes: Uint8Array;
}

export interface WebFetchOperations {
  fetch: (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<WebFetchResponse>;
}

export interface WebFetchToolOptions {
  operations?: WebFetchOperations;
  userAgent?: string;
}

function acceptHeader(format: Format): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
  }
}

function buildHeaders(format: Format, userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: acceptHeader(format),
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function mimeFrom(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isImageAttachment(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet";
}

function isTextualMime(mime: string): boolean {
  return (
    mime === "" ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  );
}

function convert(content: string, contentType: string, format: Format): string {
  if (!contentType.includes("text/html")) return content;
  if (format === "markdown") return convertHTMLToMarkdown(content);
  if (format === "text") return extractTextFromHTML(content);
  return content;
}

function isCloudflareChallenge(response: WebFetchResponse): boolean {
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge";
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http:// or https://");
  }
  return url;
}

function clampTimeout(timeout: number | undefined): number {
  const value = timeout ?? DEFAULT_TIMEOUT_SECONDS;
  if (value < 1) return 1;
  if (value > MAX_TIMEOUT_SECONDS) return MAX_TIMEOUT_SECONDS;
  return value;
}

export const defaultWebFetchOperations: WebFetchOperations = {
  async fetch(url, init) {
    const response = await fetch(url, init);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const bytes = response.body
      ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
      : new Uint8Array();
    return { status: response.status, statusText: response.statusText, headers, bytes };
  },
};

export function createWebFetchTool(
  options?: WebFetchToolOptions,
): AgentTool<typeof webfetchSchema, WebFetchToolDetails> {
  const operations = options?.operations ?? defaultWebFetchOperations;
  const userAgent = options?.userAgent ?? BROWSER_USER_AGENT;

  return {
    name: "webfetch",
    label: "webfetch",
    description: `Fetch content from an HTTP or HTTPS URL and return it as markdown (default), text, or HTML. Read-only. Validates the URL, caps the response at ${formatSize(MAX_RESPONSE_BYTES)}, and times out after ${DEFAULT_TIMEOUT_SECONDS}s by default (max ${MAX_TIMEOUT_SECONDS}s). Non-text content (e.g. images, binaries) is rejected. HTML is converted to markdown via Turndown; use format "text" for tag-stripped plain text or "html" for the raw page.`,
    parameters: webfetchSchema,
    permissions: (params) => [
      { permission: "webfetch", patterns: [(params as WebFetchToolInput).url] },
    ],
    async execute(_toolCallId, input, signal) {
      const format: Format = input.format ?? "markdown";
      const parsedUrl = parseHttpUrl(input.url);

      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      if (signal) {
        if (signal.aborted) throw new Error("Operation aborted");
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }

      const timeoutMs = clampTimeout(input.timeout) * 1000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const doFetch = (ua: string): Promise<WebFetchResponse> =>
          operations.fetch(parsedUrl.toString(), {
            headers: buildHeaders(format, ua),
            signal: controller.signal,
          });

        let response: WebFetchResponse;
        try {
          response = await doFetch(userAgent);
          if (isCloudflareChallenge(response)) {
            response = await doFetch("sakti");
          }
        } catch (error) {
          if (signal?.aborted) throw new Error("Operation aborted");
          if (controller.signal.aborted) throw new Error("Request timed out");
          throw error;
        }

        if (response.status < 200 || response.status >= 300) {
          throw new Error(
            response.statusText
              ? `HTTP ${response.status} ${response.statusText}`
              : `HTTP ${response.status}`,
          );
        }

        const contentType = response.headers["content-type"] ?? "";
        const mime = mimeFrom(contentType);
        if (isImageAttachment(mime)) {
          throw new Error(`Unsupported fetched image content type: ${mime}`);
        }
        if (!isTextualMime(mime)) {
          throw new Error(`Unsupported fetched file content type: ${mime}`);
        }

        const decoded = new TextDecoder().decode(response.bytes);
        const output = convert(decoded, contentType, format);
        const truncation = truncateHead(output);

        const details: WebFetchToolDetails = {
          url: parsedUrl.toString(),
          contentType,
          format,
        };
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
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}
