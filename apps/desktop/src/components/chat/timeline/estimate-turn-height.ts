import {
  clearCache,
  layout,
  type PreparedText,
  prepare,
} from "@chenglou/pretext";
import type { ChatTurn } from "~/stores/session/turn-projection";
import type { MessagePart, UIMessage } from "~/stores/types";

// ── Font constants ──────────────────────────────────────────────────
// Tailwind text-sm: 14px / 20px line-height
const BODY_FONT =
  '14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const BODY_LINE_HEIGHT = 20;

// Tailwind text-sm leading-relaxed: 14px * 1.625 ≈ 22.75
const THINKING_LINE_HEIGHT = 22.75;

// Tailwind text-xs: 12px / 16px line-height
const META_LINE_HEIGHT = 16;

// ── Layout constants (px) — must match component CSS ────────────────
const TIMELINE_PADDING_X = 32; // px-4 (16 + 16)
const ASSISTANT_PADDING_X = 24; // px-3 (12 + 12)
const USER_BOX_PADDING_Y = 24; // p-3 (12 + 12)
const USER_BOX_PADDING_X = 24; // p-3 (12 + 12)
const USER_LABEL_HEIGHT = META_LINE_HEIGHT; // text-xs "You" label
const USER_LABEL_GAP = 8; // gap-2 between label and text

const THINKING_PADDING_Y = 20; // py-2.5 (10 + 10)
const THINKING_PADDING_LEFT = 16; // pl-4
const THINKING_PADDING_RIGHT = 12; // pr-3

const TOOL_ROW_HEIGHT = 32; // py-1.5 (6+6) + text-sm line-height 20
const PART_GAP = 8; // gap-2
const ASSISTANT_MSG_GAP = 12; // gap-3
const TURN_CHILD_GAP = 12; // gap-3 (CHAT_STACK_GAP_CLASS)

const STATUS_ROW_HEIGHT = 20; // spinner + text-xs
const ERROR_HEIGHT = 44; // p-3 + one text-sm line
const WAITING_HEIGHT = 84; // py-8 (32+32) + text-sm line
const TURN_SPACING = 20; // inter-turn gap (was gap-5)

// ── Pretext cache ───────────────────────────────────────────────────
const hasSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl;
const preparedCache = new Map<string, PreparedText>();

function getPrepared(text: string, font: string): PreparedText | null {
  if (!hasSegmenter) {
    return null;
  }
  const key = `${font}:${text}`;
  const cached = preparedCache.get(key);
  if (cached) {
    return cached;
  }
  const prepared = prepare(text, font, {
    letterSpacing: 0,
    whiteSpace: "pre-wrap",
  });
  preparedCache.set(key, prepared);
  return prepared;
}

function fallbackTextHeight(
  text: string,
  width: number,
  lineHeight: number
): number {
  const avgCharWidth = 7;
  const charsPerLine = Math.max(1, Math.floor(width / avgCharWidth));
  let height = 0;
  for (const paragraph of text.split("\n")) {
    const lineCount = Math.max(1, Math.ceil(paragraph.length / charsPerLine));
    height += lineCount * lineHeight;
  }
  return height;
}

function measureText(
  text: string,
  font: string,
  width: number,
  lineHeight: number
): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return lineHeight;
  }
  const prepared = getPrepared(trimmed, font);
  if (!prepared) {
    return Math.max(lineHeight, fallbackTextHeight(trimmed, width, lineHeight));
  }
  return Math.max(
    lineHeight,
    layout(prepared, Math.max(1, width), lineHeight).height
  );
}

// ── Per-part height ─────────────────────────────────────────────────

function estimatePartHeight(
  part: MessagePart,
  textWidth: number,
  thinkingTextWidth: number
): number {
  switch (part.type) {
    case "text":
      return measureText(part.text, BODY_FONT, textWidth, BODY_LINE_HEIGHT);
    case "thinking":
      return (
        THINKING_PADDING_Y +
        measureText(
          part.text,
          BODY_FONT,
          thinkingTextWidth,
          THINKING_LINE_HEIGHT
        )
      );
    case "tool_call":
      return TOOL_ROW_HEIGHT;
  }
}

function estimateAssistantMessageHeight(
  msg: UIMessage,
  textWidth: number,
  thinkingTextWidth: number
): number {
  let height = 0;
  let first = true;
  for (const part of msg.parts) {
    if (!first) {
      height += PART_GAP;
    }
    first = false;
    height += estimatePartHeight(part, textWidth, thinkingTextWidth);
  }
  return height;
}

function estimateAssistantBlockHeight(
  turn: ChatTurn,
  contentWidth: number
): number {
  if (turn.assistantMessages.length === 0) {
    return turn.working ? WAITING_HEIGHT : 0;
  }

  const textWidth = contentWidth - ASSISTANT_PADDING_X;
  const thinkingTextWidth =
    textWidth - THINKING_PADDING_LEFT - THINKING_PADDING_RIGHT;

  let height = 0;
  let first = true;
  for (const msg of turn.assistantMessages) {
    if (!first) {
      height += ASSISTANT_MSG_GAP;
    }
    first = false;
    height += estimateAssistantMessageHeight(msg, textWidth, thinkingTextWidth);
  }
  return height;
}

function estimateUserMessageHeight(
  content: string,
  contentWidth: number
): number {
  const userTextWidth = contentWidth - USER_BOX_PADDING_X;
  return (
    USER_BOX_PADDING_Y +
    USER_LABEL_HEIGHT +
    USER_LABEL_GAP +
    measureText(content, BODY_FONT, userTextWidth, BODY_LINE_HEIGHT)
  );
}

// ── Turn height estimation ──────────────────────────────────────────

export function estimateTurnHeight(
  turn: ChatTurn,
  scrollWidth: number
): number {
  const contentWidth = Math.max(1, scrollWidth - TIMELINE_PADDING_X);
  let height = TURN_SPACING;

  if (turn.userMessage) {
    height += estimateUserMessageHeight(
      turn.userMessage.content ?? "",
      contentWidth
    );
    height += TURN_CHILD_GAP;
  }

  if (turn.working) {
    height += STATUS_ROW_HEIGHT + TURN_CHILD_GAP;
  }

  height += estimateAssistantBlockHeight(turn, contentWidth);

  if (turn.error && !turn.working) {
    height += ERROR_HEIGHT;
  }

  return Math.ceil(height);
}

export function clearPretextCache(): void {
  preparedCache.clear();
  clearCache();
}
