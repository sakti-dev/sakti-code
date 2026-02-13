/**
 * Markdown - Markdown rendering with syntax highlighting
 *
 * Features:
 * - marked + marked-shiki for syntax highlighting
 * - DOMPurify sanitization
 * - morphdom for efficient updates
 * - LRU cache (200 entries)
 * - Copy button on code blocks
 * - Custom Shiki theme matching ekacode colors
 */

import { finalizeMarkdownInChunks } from "@/components/shared/markdown-finalizer";
import { sanitizeMarkdownHtml } from "@/components/shared/markdown-sanitizer";
import {
  recordMarkdownCommit,
  recordMarkdownDroppedFrames,
  recordMarkdownFinalizationStats,
  recordMarkdownForcedFlush,
  recordMarkdownFullCommit,
  recordMarkdownLiteCommit,
  recordMarkdownLongTask,
  recordMarkdownRafSkippedApply,
  recordMarkdownStageMs,
} from "@/core/chat/services/markdown-perf-telemetry";
import { cn } from "@/utils";
import { marked } from "marked";
import markedShiki from "marked-shiki";
import morphdom from "morphdom";
import { createHighlighter, type Highlighter } from "shiki";
import { createEffect, createResource, createSignal, onCleanup } from "solid-js";
// Icon import removed - not used in this component

// LRU Cache for rendered HTML
interface CacheEntry {
  html: string;
  timestamp: number;
}

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private maxAge: number;

  constructor(maxSize = 200, maxAge = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
  }

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if entry is too old
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.html;
  }

  set(key: string, html: string): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, { html, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Simple checksum function for cache key
function checksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// Initialize markdown with shiki extension
let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;
let markedConfigured = false;
let markedConfigurePromise: Promise<void> | null = null;
let longTaskObserverAttached = false;

export const MARKDOWN_STREAM_CADENCE_MS = 180;
export const MARKDOWN_SCROLL_CADENCE_MS = 280;
export const MARKDOWN_MAX_STALE_MS = 900;
export const MARKDOWN_FINALIZE_CHUNK_SIZE = 2;
export const MARKDOWN_FINALIZE_FRAME_BUDGET_MS = 4;

function nowMs(): number {
  if (typeof performance === "undefined") {
    return Date.now();
  }
  return performance.now();
}

async function getHighlighter() {
  if (highlighterInstance) return highlighterInstance;
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: [
      "javascript",
      "typescript",
      "jsx",
      "tsx",
      "python",
      "rust",
      "go",
      "bash",
      "sh",
      "json",
      "yaml",
      "toml",
      "markdown",
      "html",
      "css",
      "scss",
    ],
  });

  highlighterInstance = await highlighterPromise;
  highlighterPromise = null;
  return highlighterInstance;
}

// Configure marked with shiki extension
async function configureMarked() {
  const highlighter = await getHighlighter();

  marked.use(
    markedShiki({
      highlight: async (code, lang) => {
        if (!lang) return code;
        try {
          const html = highlighter.codeToHtml(code, {
            lang,
            theme: "github-dark",
          });
          return html;
        } catch {
          return code;
        }
      },
      container: '<pre class="shiki" data-language="%l"><code>%s</code></pre>',
    })
  );
}

async function ensureMarkedConfigured() {
  if (markedConfigured) return;
  if (markedConfigurePromise) return markedConfigurePromise;

  markedConfigurePromise = configureMarked().then(() => {
    markedConfigured = true;
  });
  try {
    await markedConfigurePromise;
  } finally {
    markedConfigurePromise = null;
  }
}

const markdownCache = new LRUCache(200, 5 * 60 * 1000);
const markdownNormalizedCache = new LRUCache(200, 5 * 60 * 1000);

interface MarkdownProps {
  /** Markdown text to render */
  text: string;
  /** Additional CSS classes */
  class?: string;
  /** Whether this content is still streaming */
  isStreaming?: boolean;
  /** Cadence for markdown recompute while streaming */
  streamCadenceMs?: number;
  /** Enable light streaming mode to avoid full parse on each update */
  streamLiteEnabled?: boolean;
  /** Adaptive cadence while user is scrolling */
  scrollCadenceMs?: number;
  /** Adaptive cadence while streaming and idle */
  idleCadenceMs?: number;
  /** Maximum stale duration before forcing a streaming flush */
  maxStaleMs?: number;
  /** Number of markdown blocks processed per finalization step */
  finalizeChunkSize?: number;
  /** Per-frame processing budget for chunked finalization */
  finalizeFrameBudgetMs?: number;
  /** Defer shiki highlighting until stream completion */
  deferHighlightUntilComplete?: boolean;
  /** Pause markdown recompute while user is actively scrolling */
  pauseWhileScrolling?: boolean;
  /** Whether the user is currently scrolling */
  isScrollActive?: boolean;
}

type RenderMode = "lite" | "full";
type RenderPayload = { html: string; mode: RenderMode; text: string };

function shouldUseShiki(
  text: string,
  isStreaming: boolean | undefined,
  deferHighlightUntilComplete: boolean
): boolean {
  if (!text.includes("```")) return false;
  if (!isStreaming) return true;
  return !deferHighlightUntilComplete;
}

function hasUnclosedCodeFence(text: string): boolean {
  const fenceCount = text.match(/```/g)?.length ?? 0;
  return fenceCount % 2 === 1;
}

function hasUnstableTableTail(text: string): boolean {
  if (text.endsWith("\n\n")) return false;
  const lines = text.split("\n");
  const tail = (lines[lines.length - 1] ?? "").trim();
  if (!tail.includes("|")) return false;
  return !tail.endsWith("|");
}

function shouldDeferStreamingParse(text: string): boolean {
  return hasUnclosedCodeFence(text) || hasUnstableTableTail(text);
}

function shouldRunStructuredParse(text: string): boolean {
  if (!text) return false;
  if (shouldDeferStreamingParse(text)) return false;
  if (text.endsWith("```")) return true;
  const last = text[text.length - 1] ?? "";
  if (last === "\n" || last === "|" || last === "." || last === "!" || last === "?") return true;
  return false;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStreamingLite(text: string): string {
  const escaped = escapeHtml(text);
  return `<p>${escaped.replaceAll("\n", "<br/>")}</p>`;
}

function normalizeForCache(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function waitForIdle(): Promise<void> {
  if (typeof requestIdleCallback !== "function") return;
  await new Promise<void>(resolve => {
    requestIdleCallback(() => resolve(), { timeout: 120 });
  });
}

/**
 * Markdown component
 *
 * @example
 * ```tsx
 * <Markdown text="# Hello\n\n```js\nconsole.log('hi')\n```" />
 * ```
 */
export function Markdown(props: MarkdownProps) {
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [_copied, setCopied] = createSignal<string | null>(null);
  const [renderText, setRenderText] = createSignal(props.text);
  let pendingText: string | null = null;
  let lastRenderedHtml = "";
  let cadenceTimeout: ReturnType<typeof setTimeout> | undefined;
  let staleTimeout: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | undefined;
  let domApplyRafId: number | undefined;
  let copySetupIdleId: number | undefined;
  let copySetupTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastRafTs = 0;
  let queuedRender: RenderPayload | null = null;
  let queuedRenderScheduled = false;
  let lastRenderedText = "";
  let lastRenderMode: RenderMode | null = null;

  const getCadence = () => {
    if (props.streamCadenceMs !== undefined) return props.streamCadenceMs;
    if (props.isScrollActive) return props.scrollCadenceMs ?? MARKDOWN_SCROLL_CADENCE_MS;
    return props.idleCadenceMs ?? MARKDOWN_STREAM_CADENCE_MS;
  };
  const shouldPauseForScroll = () =>
    Boolean(props.pauseWhileScrolling ?? true) && !!props.isScrollActive;
  const getMaxStaleMs = () => props.maxStaleMs ?? MARKDOWN_MAX_STALE_MS;
  const getFinalizeChunkSize = () => props.finalizeChunkSize ?? MARKDOWN_FINALIZE_CHUNK_SIZE;
  const getFinalizeFrameBudgetMs = () =>
    props.finalizeFrameBudgetMs ?? MARKDOWN_FINALIZE_FRAME_BUDGET_MS;

  const clearCadenceTimer = () => {
    if (!cadenceTimeout) return;
    clearTimeout(cadenceTimeout);
    cadenceTimeout = undefined;
  };

  const clearStaleTimer = () => {
    if (!staleTimeout) return;
    clearTimeout(staleTimeout);
    staleTimeout = undefined;
  };

  const commitText = (text: string) => {
    setRenderText(current => (current === text ? current : text));
  };

  const flushPendingText = (force = false, bypassStructure = false) => {
    if (pendingText === null) return;
    const nextText = pendingText;
    if (!force && !bypassStructure && props.isStreaming && shouldDeferStreamingParse(nextText)) {
      return;
    }
    pendingText = null;
    commitText(nextText);
  };

  const scheduleCadencedFlush = () => {
    if (cadenceTimeout) return;
    cadenceTimeout = setTimeout(() => {
      cadenceTimeout = undefined;
      flushPendingText(false);
    }, getCadence());
  };

  const scheduleMaxStaleFlush = () => {
    if (!props.isStreaming) return;
    if (staleTimeout) return;
    staleTimeout = setTimeout(() => {
      staleTimeout = undefined;
      if (pendingText === null) return;
      recordMarkdownForcedFlush();
      flushPendingText(false, true);
    }, getMaxStaleMs());
  };

  createEffect(() => {
    const nextText = props.text;
    const streaming = props.isStreaming ?? false;
    const pauseForScroll = shouldPauseForScroll();

    if (!streaming) {
      clearCadenceTimer();
      clearStaleTimer();
      pendingText = null;
      commitText(nextText);
      return;
    }

    pendingText = nextText;
    scheduleMaxStaleFlush();
    if (pauseForScroll) return;
    scheduleCadencedFlush();
  });

  createEffect(() => {
    const streaming = props.isStreaming ?? false;
    if (streaming) return;
    clearCadenceTimer();
    clearStaleTimer();
    flushPendingText(true);
  });

  createEffect(() => {
    const streaming = props.isStreaming ?? false;
    if (!streaming) return;
    const pauseForScroll = shouldPauseForScroll();
    if (pauseForScroll) return;
    if (pendingText === null) return;
    scheduleCadencedFlush();
    scheduleMaxStaleFlush();
  });

  onCleanup(() => {
    clearCadenceTimer();
    clearStaleTimer();
    if (rafId !== undefined && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
    if (domApplyRafId !== undefined && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(domApplyRafId);
    }
    if (copySetupIdleId !== undefined && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(copySetupIdleId);
    }
    if (copySetupTimeout) {
      clearTimeout(copySetupTimeout);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.requestAnimationFrame !== "function") return;
    if (rafId !== undefined) return;

    const tick = (ts: number) => {
      if (lastRafTs > 0) {
        const delta = ts - lastRafTs;
        const dropped = Math.max(0, Math.floor(delta / 16.7) - 1);
        if (dropped > 0) {
          recordMarkdownDroppedFrames(dropped);
        }
      }
      lastRafTs = ts;
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
  });

  createEffect(() => {
    if (longTaskObserverAttached) return;
    if (typeof PerformanceObserver === "undefined") return;

    try {
      const observer = new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (entries.length === 0) return;
        for (const entry of entries) {
          if (entry.duration >= 50) {
            recordMarkdownLongTask();
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      longTaskObserverAttached = true;
    } catch {
      // Longtask observer is optional and browser-dependent.
    }
  });

  const [html] = createResource(
    () => {
      const text = renderText();
      const deferHighlightUntilComplete = props.deferHighlightUntilComplete ?? true;
      const streamLiteEnabled = props.streamLiteEnabled ?? true;
      const isStreaming = props.isStreaming ?? false;
      const renderMode: RenderMode =
        isStreaming && streamLiteEnabled && !shouldRunStructuredParse(text) ? "lite" : "full";
      return {
        text,
        isStreaming,
        renderMode,
        useShiki: shouldUseShiki(text, props.isStreaming, deferHighlightUntilComplete),
      };
    },
    async payload => {
      const { text, useShiki, renderMode, isStreaming } = payload;
      if (!text) return { html: "", mode: renderMode, text };
      const totalStart = nowMs();
      if (renderMode === "full" && useShiki) {
        await ensureMarkedConfigured();
      }
      const runChunkedFinalization = renderMode === "full" && !isStreaming;
      if (runChunkedFinalization) await waitForIdle();

      const hash = checksum(`${renderMode}:${useShiki ? "shiki" : "plain"}:${text}`);
      const cached = markdownCache.get(hash);
      if (cached) {
        return { html: cached, mode: renderMode, text };
      }
      if (renderMode === "full") {
        const normalizedHash = checksum(
          `${renderMode}:${useShiki ? "shiki" : "plain"}:${normalizeForCache(text)}`
        );
        const normalizedCached = markdownNormalizedCache.get(normalizedHash);
        if (normalizedCached) {
          markdownCache.set(hash, normalizedCached);
          return { html: normalizedCached, mode: renderMode, text };
        }
      }

      try {
        let parsed = "";
        if (renderMode === "lite") {
          parsed = renderStreamingLite(text);
        } else {
          if (runChunkedFinalization) {
            const result = await finalizeMarkdownInChunks(
              text,
              async block => {
                const parseStart = nowMs();
                const output = await marked.parse(block);
                recordMarkdownStageMs("parse", nowMs() - parseStart);
                return output;
              },
              async html => {
                const sanitizeStart = nowMs();
                const output = await sanitizeMarkdownHtml(html, { mode: "full" });
                recordMarkdownStageMs("sanitize", nowMs() - sanitizeStart);
                return output;
              },
              {
                chunkSize: getFinalizeChunkSize(),
                frameBudgetMs: getFinalizeFrameBudgetMs(),
              }
            );
            recordMarkdownFinalizationStats(result);
            recordMarkdownStageMs("total", result.totalMs);
            const output = result.html;
            markdownCache.set(hash, output);
            const normalizedHash = checksum(
              `${renderMode}:${useShiki ? "shiki" : "plain"}:${normalizeForCache(text)}`
            );
            markdownNormalizedCache.set(normalizedHash, output);
            return { html: output, mode: renderMode, text };
          }
          const parseStart = nowMs();
          parsed = isStreaming
            ? await marked.parse(text, { gfm: false, breaks: true })
            : await marked.parse(text);
          recordMarkdownStageMs("parse", nowMs() - parseStart);
        }

        const sanitizeStart = nowMs();
        const sanitized = await sanitizeMarkdownHtml(parsed, {
          mode: renderMode === "lite" ? "stream-lite" : "full",
        });
        recordMarkdownStageMs("sanitize", nowMs() - sanitizeStart);
        recordMarkdownStageMs("total", nowMs() - totalStart);
        markdownCache.set(hash, sanitized);
        if (renderMode === "full") {
          const normalizedHash = checksum(
            `${renderMode}:${useShiki ? "shiki" : "plain"}:${normalizeForCache(text)}`
          );
          markdownNormalizedCache.set(normalizedHash, sanitized);
        }
        return { html: sanitized, mode: renderMode, text };
      } catch {
        return { html: "", mode: renderMode, text };
      }
    }
  );

  const scheduleCopySetup = (container: HTMLElement) => {
    if (copySetupIdleId !== undefined && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(copySetupIdleId);
      copySetupIdleId = undefined;
    }
    if (copySetupTimeout) {
      clearTimeout(copySetupTimeout);
      copySetupTimeout = undefined;
    }

    const run = () => {
      const copyStart = nowMs();
      setupCodeCopy(container);
      recordMarkdownStageMs("copyButtons", nowMs() - copyStart);
    };

    if (typeof requestIdleCallback === "function") {
      copySetupIdleId = requestIdleCallback(
        () => {
          copySetupIdleId = undefined;
          run();
        },
        { timeout: 120 }
      );
      return;
    }
    copySetupTimeout = setTimeout(() => {
      copySetupTimeout = undefined;
      run();
    }, 0);
  };

  const tryAppendLiteDelta = (container: HTMLElement, text: string): boolean => {
    if (lastRenderMode !== "lite") return false;
    if (!text.startsWith(lastRenderedText)) return false;
    const delta = text.slice(lastRenderedText.length);
    if (!delta) return true;
    const rootChild = container.firstElementChild;
    if (!(rootChild instanceof HTMLElement) || rootChild.tagName !== "P") return false;
    rootChild.insertAdjacentHTML("beforeend", escapeHtml(delta).replaceAll("\n", "<br/>"));
    return true;
  };

  const applyDomRender = (container: HTMLElement, payload: RenderPayload) => {
    const { html: content, mode, text } = payload;
    if (!content) {
      lastRenderedHtml = "";
      lastRenderedText = "";
      lastRenderMode = null;
      container.innerHTML = "";
      return;
    }
    if (mode === "lite" && tryAppendLiteDelta(container, text)) {
      recordMarkdownLiteCommit();
      recordMarkdownCommit();
      lastRenderedText = text;
      lastRenderMode = mode;
      return;
    }
    if (content === lastRenderedHtml) return;
    lastRenderedHtml = content;
    lastRenderedText = text;
    lastRenderMode = mode;
    const morphStart = nowMs();

    const template = document.createElement("template");
    template.innerHTML = `<div class="markdown-content">${content}</div>`;

    morphdom(container, template.content.firstChild as HTMLElement, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, _toEl) => {
        if (
          fromEl instanceof HTMLElement &&
          fromEl.tagName === "PRE" &&
          fromEl.querySelector("code")?.textContent
        ) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (fromEl.contains(range.commonAncestorContainer)) {
              return false;
            }
          }
        }
        return true;
      },
    });
    recordMarkdownStageMs("morph", nowMs() - morphStart);

    if (mode === "full") {
      scheduleCopySetup(container);
      recordMarkdownFullCommit();
    } else {
      recordMarkdownLiteCommit();
    }
    recordMarkdownCommit();
  };

  const scheduleDomApply = (container: HTMLElement, next: RenderPayload) => {
    queuedRender = next;
    if (typeof requestAnimationFrame !== "function") {
      const immediate = queuedRender;
      queuedRender = null;
      queuedRenderScheduled = false;
      if (immediate) {
        applyDomRender(container, immediate);
      }
      return;
    }
    if (queuedRenderScheduled) {
      recordMarkdownRafSkippedApply();
      return;
    }
    queuedRenderScheduled = true;
    domApplyRafId = requestAnimationFrame(() => {
      domApplyRafId = undefined;
      queuedRenderScheduled = false;
      const payload = queuedRender;
      queuedRender = null;
      if (!payload) return;
      applyDomRender(container, payload);
    });
  };

  createEffect(() => {
    const container = root();
    const payload = html();
    if (!container) return;
    if (!payload) return;
    scheduleDomApply(container, payload);
  });

  const setupCodeCopy = (container: HTMLElement) => {
    const codeBlocks = container.querySelectorAll<HTMLDivElement>(
      '[data-component="markdown-code"]:not([data-copy-initialized="1"])'
    );

    codeBlocks.forEach(block => {
      // Check if button already exists
      if (block.querySelector('[data-slot="markdown-copy-button"]')) return;

      const code = block.querySelector("code");
      if (!code) return;

      const language = code.getAttribute("data-language") || "text";
      const text = code.textContent || "";

      const button = document.createElement("button");
      button.setAttribute("data-slot", "markdown-copy-button");
      button.setAttribute("aria-label", "Copy code");
      button.className =
        "absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-card/80 border border-border/40 rounded p-1.5 transition-opacity duration-150 hover:bg-card hover:border-primary/30";

      button.innerHTML = `<svg class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M8 4H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2v-2M16 4h2a2 2 0 012 2v4M21 14H11m4 0l-3 3m3-3l-3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

      button.onclick = async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(language + code.textContent?.slice(0, 10));
          setTimeout(() => setCopied(null), 2000);
        } catch {
          // Fallback: select text
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      };

      // Add group class to parent for hover effect
      block.classList.add("group");
      block.style.position = "relative";
      block.dataset.copyInitialized = "1";

      // Insert button
      block.appendChild(button);
    });
  };

  return (
    <div
      ref={setRoot}
      data-component="markdown"
      class={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
        "prose-p:leading-relaxed prose-p:text-foreground/90",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-mono",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border/40",
        "prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic",
        "prose-ul:list-disc prose-ol:list-decimal",
        "prose-li:marker:text-muted-foreground",
        props.class
      )}
    />
  );
}

/**
 * InlineMarkdown - For inline text without block elements
 *
 * @example
 * ```tsx
 * <InlineMarkdown text="This is **bold** and `code`" />
 * ```
 */
export function InlineMarkdown(props: { text: string; class?: string }) {
  return (
    <Markdown
      text={props.text}
      class={cn(
        "prose-p:m-0 prose-p:inline",
        "prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0",
        props.class
      )}
    />
  );
}

export default Markdown;
