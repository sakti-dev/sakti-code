import DOMPurify from "dompurify";

const ALLOWED_TAGS_FULL = [
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
];

const ALLOWED_TAGS_STREAM_LITE = ["p", "br", "code", "pre", "span", "strong", "em"];

const ALLOWED_ATTR = ["href", "class", "data-component", "data-language", "data-slot", "style"];

type SanitizerMode = "full" | "stream-lite";

const sanitizeWithDomPurify = (dirty: string, mode: SanitizerMode): string =>
  DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: mode === "stream-lite" ? ALLOWED_TAGS_STREAM_LITE : ALLOWED_TAGS_FULL,
    ALLOWED_ATTR,
  });

export async function sanitizeMarkdownHtml(
  dirty: string,
  options?: { mode?: SanitizerMode }
): Promise<string> {
  return sanitizeWithDomPurify(dirty, options?.mode ?? "full");
}
