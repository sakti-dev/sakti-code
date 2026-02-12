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

import { cn } from "@/utils";
import DOMPurify from "dompurify";
import { marked } from "marked";
import markedShiki from "marked-shiki";
import morphdom from "morphdom";
import { createHighlighter, type Highlighter } from "shiki";
import { createEffect, createResource, createSignal } from "solid-js";
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

async function getHighlighter() {
  if (highlighterInstance) return highlighterInstance;

  highlighterInstance = await createHighlighter({
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

// Initialize on module load
let markedConfigured = false;
const markdownCache = new LRUCache(200, 5 * 60 * 1000);

interface MarkdownProps {
  /** Markdown text to render */
  text: string;
  /** Additional CSS classes */
  class?: string;
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

  const [html] = createResource(
    () => props.text,
    async text => {
      if (!text) return "";
      if (!markedConfigured) {
        await configureMarked();
        markedConfigured = true;
      }

      const hash = checksum(text);
      const cached = markdownCache.get(hash);
      if (cached) return cached;

      try {
        const parsed = await marked.parse(text);
        const sanitized = DOMPurify.sanitize(parsed, {
          ALLOWED_TAGS: [
            "p",
            "br",
            "strong",
            "em",
            "u",
            "s",
            "code",
            "pre",
            "a",
            "ul",
            "ol",
            "li",
            "blockquote",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "hr",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
            "span",
            "div",
          ],
          ALLOWED_ATTR: ["href", "class", "data-component", "data-language", "data-slot", "style"],
        });
        markdownCache.set(hash, sanitized);
        return sanitized;
      } catch {
        return "";
      }
    }
  );

  createEffect(() => {
    const container = root();
    const content = html();
    if (!container || !content) return;

    // Parse HTML string to DOM for morphdom
    const template = document.createElement("template");
    template.innerHTML = `<div class="markdown-content">${content}</div>`;

    morphdom(container, template.content.firstChild as HTMLElement, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, _toEl) => {
        // Don't update code blocks if user is selecting text
        if (
          fromEl instanceof HTMLElement &&
          fromEl.tagName === "PRE" &&
          fromEl.querySelector("code")?.textContent
        ) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (fromEl.contains(range.commonAncestorContainer)) {
              return false; // Skip update
            }
          }
        }
        return true;
      },
    });

    // Setup copy buttons on code blocks
    setupCodeCopy(container);
  });

  const setupCodeCopy = (container: HTMLElement) => {
    const codeBlocks = container.querySelectorAll<HTMLDivElement>(
      '[data-component="markdown-code"]'
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
