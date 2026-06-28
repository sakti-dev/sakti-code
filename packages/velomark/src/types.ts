import type { JSX } from "solid-js";

export type RenderBlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "container"
  | "html"
  | "html-element"
  | "math"
  | "blockquote"
  | "list"
  | "thematic-break"
  | "table"
  | "fallback";

export type RenderBlockStatus = "streaming" | "complete";

export interface InlineCodeToken {
  text: string;
  type: "code";
}

export interface InlineEmphasisToken {
  children: InlineToken[];
  type: "emphasis";
}

export interface InlineDeleteToken {
  children: InlineToken[];
  type: "delete";
}

export interface InlineBreakToken {
  type: "break";
}

export interface InlineFootnoteReferenceToken {
  identifier: string;
  type: "footnote-reference";
}

export interface InlineMathToken {
  type: "inline-math";
  value: string;
}

export interface InlineHtmlToken {
  type: "html";
  value: string;
}

export interface InlineHtmlElementToken {
  attributes?: Record<string, string>;
  children: InlineToken[];
  tagName: string;
  type: "html-element";
}

export interface InlineDirectiveToken {
  attributes?: Record<string, string>;
  children: InlineToken[];
  name: string;
  type: "text-directive";
}

export interface InlineImageToken {
  alt: string;
  src: string;
  title?: string;
  type: "image";
}

export interface ReferenceDefinition {
  href: string;
  title?: string;
}

export type ReferenceDefinitionMap = Record<string, ReferenceDefinition>;

export interface InlineLinkToken {
  children: InlineToken[];
  href: string;
  title?: string;
  type: "link";
}

export interface InlineStrongToken {
  children: InlineToken[];
  type: "strong";
}

export interface InlineTextToken {
  text: string;
  type: "text";
}

export type InlineToken =
  | InlineBreakToken
  | InlineCodeToken
  | InlineDeleteToken
  | InlineDirectiveToken
  | InlineEmphasisToken
  | InlineHtmlElementToken
  | InlineFootnoteReferenceToken
  | InlineHtmlToken
  | InlineMathToken
  | InlineImageToken
  | InlineLinkToken
  | InlineStrongToken
  | InlineTextToken;

export interface RenderBlock<TData = unknown> {
  data: TData;
  fingerprint: string;
  id: string;
  kind: RenderBlockKind;
  sourceEnd: number;
  sourceStart: number;
  status: RenderBlockStatus;
}

export interface RenderDocument<TData = unknown> {
  blocks: RenderBlock<TData>[];
  definitions: ReferenceDefinitionMap;
  footnoteDefinitions: Record<string, RenderBlock<TData>[]>;
  footnoteReferenceOrder: string[];
  version: number;
}

export interface VelomarkDebugMetrics {
  appendedBlockCount: number;
  blockCount: number;
  replacedBlockCount: number;
  reusedBlockCount: number;
}

export interface VelomarkCodeBlockOptions {
  copyButton?: boolean;
  defaultView?: "preview" | "source";
  highlight?: boolean;
  highlightTheme?: string;
  languageLabel?: boolean;
  previewToggle?: boolean;
}

export interface VelomarkCodeBlockRendererProps {
  code: string;
  language?: string;
}

export interface VelomarkContainerRendererProps {
  attributes?: Record<string, string>;
  children?: JSX.Element;
  name: string;
}
