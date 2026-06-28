import type { InlineToken } from "../types";

export interface HtmlElementNode {
  attributes?: Record<string, string>;
  children: HtmlElementChild[];
  tagName: string;
}

export type HtmlElementChild =
  | {
      text: string;
      type: "text";
    }
  | {
      node: HtmlElementNode;
      type: "element";
    };

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ATTRIBUTE_RE =
  /([A-Za-z_:][A-Za-z0-9:._-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const SIMPLE_HTML_OPEN_TAG_RE = /^<([A-Za-z][A-Za-z0-9-]*)(\s[^>]*)?>/;

export function parseHtmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const match of source.matchAll(ATTRIBUTE_RE)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (key) {
      attributes[key] = value;
    }
  }

  return attributes;
}

function findClosingTag(source: string, tagName: string, from: number): number {
  let depth = 1;
  let index = from;
  const openRe = new RegExp(`<${tagName}(\\s[^>]*)?>`, "gi");
  const closeRe = new RegExp(`</${tagName}>`, "gi");

  while (index < source.length) {
    openRe.lastIndex = index;
    closeRe.lastIndex = index;

    const nextOpen = openRe.exec(source);
    const nextClose = closeRe.exec(source);
    if (!nextClose) {
      return -1;
    }

    const openIndex = nextOpen?.index ?? Number.POSITIVE_INFINITY;
    const closeIndex = nextClose.index;

    if (openIndex < closeIndex) {
      depth += 1;
      index = openIndex + 1;
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return closeIndex;
    }
    index = closeIndex + 1;
  }

  return -1;
}

export function parseSimpleHtmlElement(
  source: string
): { length: number; node: HtmlElementNode } | null {
  const openMatch = source.match(SIMPLE_HTML_OPEN_TAG_RE);
  if (!(openMatch?.[0] && openMatch[1])) {
    return null;
  }

  const tagName = openMatch[1];
  const attributes = parseHtmlAttributes(openMatch[2] ?? "");
  const openLength = openMatch[0].length;

  if (VOID_ELEMENTS.has(tagName.toLowerCase()) || openMatch[0].endsWith("/>")) {
    return {
      length: openLength,
      node: { tagName, attributes, children: [] },
    };
  }

  const closeIndex = findClosingTag(source, tagName, openLength);
  if (closeIndex === -1) {
    return null;
  }

  const closeTag = `</${tagName}>`;
  const inner = source.slice(openLength, closeIndex);
  const children = parseHtmlChildren(inner);

  return {
    length: closeIndex + closeTag.length,
    node: { tagName, attributes, children },
  };
}

export function parseHtmlChildren(source: string): HtmlElementChild[] {
  const children: HtmlElementChild[] = [];
  let index = 0;

  while (index < source.length) {
    const nextTagIndex = source.indexOf("<", index);
    if (nextTagIndex === -1) {
      const text = source.slice(index);
      if (text) {
        children.push({ type: "text", text });
      }
      break;
    }

    if (nextTagIndex > index) {
      children.push({ type: "text", text: source.slice(index, nextTagIndex) });
    }

    const parsed = parseSimpleHtmlElement(source.slice(nextTagIndex));
    if (!parsed) {
      children.push({ type: "text", text: source.slice(nextTagIndex) });
      break;
    }

    children.push({ type: "element", node: parsed.node });
    index = nextTagIndex + parsed.length;
  }

  return children;
}

export function htmlElementChildrenToInlineTokens(
  children: HtmlElementChild[],
  parseInline: (text: string) => InlineToken[]
): InlineToken[] {
  const tokens: InlineToken[] = [];

  for (const child of children) {
    if (child.type === "text") {
      tokens.push(...parseInline(child.text));
      continue;
    }

    tokens.push({
      type: "html-element",
      tagName: child.node.tagName,
      attributes: child.node.attributes,
      children: htmlElementChildrenToInlineTokens(
        child.node.children,
        parseInline
      ),
    });
  }

  return tokens;
}
