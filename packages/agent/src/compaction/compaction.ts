import type {
  AssistantMessage,
  ImageContent,
  Model,
  TextContent,
  Usage,
} from "@sakti-code/llm";
import { complete } from "@sakti-code/llm";
import { Effect } from "effect";
import {
  type CompactionEntry,
  CompactionError,
  err,
  isFailure,
  ok,
  type Result,
  type SessionTreeEntry,
} from "../harness-types";
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../session/messages";
import { buildSessionContextFromEntries } from "../session/session";
import type { AgentMessage, ThinkingLevel } from "../types";
import { partitionPinnedTurns, renderPinnedTurns } from "./pinned-turns";
import type { CompactionPrompts } from "./prompt-bundles.ts";
import { type PruneStats, pruneStaleToolResults } from "./prune";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from "./utils.ts";

/** File-operation details stored on generated compaction entries. */
export interface CompactionDetails {
  /** Files modified in the compacted history. */
  modifiedFiles: string[];
  /** Files read in the compacted history. */
  readFiles: string[];
}
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function extractFileOperations(
  messages: AgentMessage[],
  entries: SessionTreeEntry[],
  prevCompactionIndex: number
): FileOperations {
  const fileOps = createFileOps();
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
    if (!prevCompaction.fromHook && prevCompaction.details) {
      const details = prevCompaction.details as CompactionDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) {
          fileOps.read.add(f);
        }
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f);
        }
      }
    }
  }
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }

  return fileOps;
}
function getMessageFromEntry(
  entry: SessionTreeEntry
): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message as AgentMessage;
  }
  if (entry.type === "custom_message") {
    return createCustomMessage(
      entry.customType,
      entry.content as string | (TextContent | ImageContent)[],
      entry.display,
      entry.details,
      entry.timestamp
    );
  }
  if (entry.type === "branch_summary") {
    return createBranchSummaryMessage(
      entry.summary,
      entry.fromId,
      entry.timestamp
    );
  }
  if (entry.type === "compaction") {
    return createCompactionSummaryMessage(
      entry.summary,
      entry.tokensBefore,
      entry.timestamp
    );
  }
  return;
}

function getMessageFromEntryForCompaction(
  entry: SessionTreeEntry
): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return;
  }
  return getMessageFromEntry(entry);
}

/** Generated compaction data ready to be persisted as a compaction entry. */
export interface CompactionResult<T = unknown> {
  /** Optional implementation-specific details stored with the compaction entry. */
  details?: T;
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Summary text that replaces compacted history in future context. */
  summary: string;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
}

/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
  /** Enable automatic compaction decisions. */
  enabled: boolean;
  /** Approximate recent-context tokens to keep after compaction. */
  keepRecentTokens: number;
  /** Tokens reserved for summary prompt and output. */
  reserveTokens: number;
}

/** Default compaction settings used by the harness. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

/** Calculate total context tokens from provider usage. */
export function calculateContextTokens(usage: Usage): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (
      assistantMsg.stopReason !== "aborted" &&
      assistantMsg.stopReason !== "error" &&
      assistantMsg.usage
    ) {
      return assistantMsg.usage;
    }
  }
  return;
}

/** Return usage from the last successful assistant message in session entries. */
export function getLastAssistantUsage(
  entries: SessionTreeEntry[]
): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === "message") {
      const usage = getAssistantUsage(entry.message as AgentMessage);
      if (usage) {
        return usage;
      }
    }
  }
  return;
}

/** Estimated context-token usage for a message list. */
export interface ContextUsageEstimate {
  /** Index of the message that provided usage, or null when none exists. */
  lastUsageIndex: number | null;
  /** Estimated total context tokens. */
  tokens: number;
  /** Estimated tokens after the most recent assistant usage block. */
  trailingTokens: number;
  /** Tokens reported by the most recent assistant usage block. */
  usageTokens: number;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[]
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]!);
    if (usage) {
      return { usage, index: i };
    }
  }
  return;
}

/** Estimate context tokens for messages using provider usage when available. */
export function estimateContextTokens(
  messages: AgentMessage[]
): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]!);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/** Return whether context usage exceeds the configured compaction threshold. */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) {
    return false;
  }
  return contextTokens > contextWindow - settings.reserveTokens;
}

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(
  content: string | Array<{ type: string; text?: string }>
): number {
  if (typeof content === "string") {
    return content.length;
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === "text" && block.text) {
      chars += block.text.length;
    } else if (block.type === "image") {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

/** Estimate token count for one message using a conservative character heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user": {
      chars = estimateTextAndImageContentChars(
        (
          message as {
            content: string | Array<{ type: string; text?: string }>;
          }
        ).content
      );
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars +=
            block.name.length + safeJsonStringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = message.command.length + message.output.length;
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary": {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }

  return 0;
}
function findValidCutPoints(
  entries: SessionTreeEntry[],
  startIndex: number,
  endIndex: number
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i]!;
    switch (entry.type) {
      case "message": {
        const role = entry.message.role;
        switch (role) {
          case "bashExecution":
          case "custom":
          case "branchSummary":
          case "compactionSummary":
          case "user":
          case "assistant":
            cutPoints.push(i);
            break;
          case "toolResult":
            break;
        }
        break;
      }
      case "thinking_level_change":
      case "model_change":
      case "active_tools_change":
      case "compaction":
      case "branch_summary":
      case "custom":
      case "custom_message":
      case "label":
      case "session_info":
      case "leaf":
        break;
    }
    if (entry.type === "branch_summary" || entry.type === "custom_message") {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

/** Find the user-visible message that starts the turn containing an entry. */
export function findTurnStartIndex(
  entries: SessionTreeEntry[],
  entryIndex: number,
  startIndex: number
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i]!;
    if (entry.type === "branch_summary" || entry.type === "custom_message") {
      return i;
    }
    if (entry.type === "message") {
      const role = entry.message.role;
      if (role === "user" || role === "bashExecution") {
        return i;
      }
    }
  }
  return -1;
}

/** Cut point selected for compaction. */
export interface CutPointResult {
  /** Index of the first entry retained after compaction. */
  firstKeptEntryIndex: number;
  /** Whether the selected cut point splits an in-progress turn. */
  isSplitTurn: boolean;
  /** Index of the turn-start entry when the cut splits a turn, otherwise -1. */
  turnStartIndex: number;
}

/** Find the compaction cut point that keeps approximately the requested recent-token budget. */
export function findCutPoint(
  entries: SessionTreeEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return {
      firstKeptEntryIndex: startIndex,
      turnStartIndex: -1,
      isSplitTurn: false,
    };
  }
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0]!;

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i]!;
    if (entry.type !== "message") {
      continue;
    }
    const messageTokens = estimateTokens(entry.message as AgentMessage);
    accumulatedTokens += messageTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c]! >= i) {
          cutIndex = cutPoints[c]!;
          break;
        }
      }
      break;
    }
  }
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1]!;
    if (prevEntry.type === "compaction") {
      break;
    }
    if (prevEntry.type === "message") {
      break;
    }
    cutIndex--;
  }
  const cutEntry = entries[cutIndex]!;
  const isUserMessage =
    cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage
    ? -1
    : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

/** Options for {@link generateSummaryEffect}. */
export interface GenerateSummaryOptions {
  readonly customInstructions?: string;
  readonly headers?: Record<string, string>;
  readonly previousSummary?: string;
  /** Required prompt bundle — caller supplies, no defaults. */
  readonly prompts: CompactionPrompts;
  readonly signal?: AbortSignal;
  readonly thinkingLevel?: ThinkingLevel;
}

/** Generate or update a conversation summary for compaction. */
export const generateSummaryEffect = (
  currentMessages: AgentMessage[],
  model: Model,
  reserveTokens: number,
  apiKey: string,
  opts: GenerateSummaryOptions
): Effect.Effect<Result<string, CompactionError>> =>
  Effect.gen(function* () {
    const maxTokens = Math.min(
      Math.floor(0.8 * reserveTokens),
      model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY
    );
    let basePrompt = opts.previousSummary
      ? opts.prompts.update
      : opts.prompts.summarization;
    if (opts.customInstructions) {
      basePrompt = `${basePrompt}\n\nAdditional focus: ${opts.customInstructions}`;
    }
    const llmMessages = convertToLlm(currentMessages);
    const conversationText = serializeConversation(llmMessages);
    let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
    if (opts.previousSummary) {
      promptText += `<previous-summary>\n${opts.previousSummary}\n</previous-summary>\n\n`;
    }
    promptText += basePrompt;

    const summarizationMessages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: promptText }],
        timestamp: Date.now(),
      },
    ];

    const completionOptions = {
      maxTokens,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      apiKey,
      ...(opts.headers === undefined ? {} : { headers: opts.headers }),
      ...(model.reasoning && opts.thinkingLevel && opts.thinkingLevel !== "off"
        ? { thinkingLevel: opts.thinkingLevel }
        : {}),
    };

    const response = yield* Effect.promise(() =>
      complete({
        model,
        messages: summarizationMessages,
        system: opts.prompts.summarizationSystem,
        ...(completionOptions.maxTokens
          ? { maxOutputTokens: completionOptions.maxTokens }
          : {}),
        ...(completionOptions.signal
          ? { abortSignal: completionOptions.signal }
          : {}),
        apiKey: completionOptions.apiKey,
        ...(completionOptions.headers
          ? { headers: completionOptions.headers }
          : {}),
        ...(completionOptions.thinkingLevel
          ? { thinkingLevel: completionOptions.thinkingLevel }
          : {}),
      })
    );
    if (response.finishReason === "error") {
      return err(
        new CompactionError({
          code: "summarization_failed",
          message: `Summarization failed: ${response.errorMessage || "Unknown error"}`,
        })
      );
    }

    const textContent = response.content.map((c) => c.text).join("\n");

    return ok(textContent);
  });

/** Prepared inputs for a compaction run. */
export interface CompactionPreparation {
  /** File operations extracted from summarized history. */
  fileOps: FileOperations;
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Whether compaction splits a turn. */
  isSplitTurn: boolean;
  /** Messages summarized into the history summary. */
  messagesToSummarize: AgentMessage[];
  /** Small user turns kept verbatim through compaction (§5.1). */
  pinnedUserTurns: AgentMessage[];
  /** Previous compaction summary used for iterative updates. */
  previousSummary?: string | undefined;
  /** Stats from the pre-compaction prune pass (§13); `results: 0` when nothing was pruned. */
  pruneStats: PruneStats;
  /** Settings used to prepare compaction. */
  settings: CompactionSettings;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
  /** Prefix messages summarized separately when compaction splits a turn. */
  turnPrefixMessages: AgentMessage[];
}

/** Prepare session entries for compaction, or return undefined when compaction is not applicable. */
export function prepareCompaction(
  pathEntries: SessionTreeEntry[],
  settings: CompactionSettings
): Result<CompactionPreparation | undefined, CompactionError> {
  if (
    pathEntries.length === 0 ||
    pathEntries[pathEntries.length - 1]!.type === "compaction"
  ) {
    return ok(undefined);
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i]!.type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    const firstKeptEntryIndex = pathEntries.findIndex(
      (entry) => entry.id === prevCompaction.firstKeptEntryId
    );
    boundaryStart =
      firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  const tokensBefore = estimateContextTokens(
    buildSessionContextFromEntries(pathEntries).messages
  ).tokens;

  const cutPoint = findCutPoint(
    pathEntries,
    boundaryStart,
    boundaryEnd,
    settings.keepRecentTokens
  );
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return err(
      new CompactionError({
        code: "invalid_session",
        message: "First kept entry has no UUID - session may need migration",
      })
    );
  }
  const firstKeptEntryId = firstKeptEntry.id;

  const historyEnd = cutPoint.isSplitTurn
    ? cutPoint.turnStartIndex
    : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]!);
    if (msg) {
      messagesToSummarize.push(msg);
    }
  }
  // Pre-compaction prune (§13): elide large stale tool results before the
  // summarizer sees them. Everything in messagesToSummarize is outside the
  // kept tail by definition, so all of it is a prune candidate. Tool output is
  // re-derivable; this shrinks the summarizer input (and its LLM call) for
  // free. File-op extraction below only reads assistant toolCall blocks, so
  // pruning toolResult content does not lose file-tracking data.
  const { pruned: prunedSummarize, stats: pruneStats } = pruneStaleToolResults(
    messagesToSummarize,
    {
      tailStartIndex: messagesToSummarize.length,
    }
  );
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (
      let i = cutPoint.turnStartIndex;
      i < cutPoint.firstKeptEntryIndex;
      i++
    ) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]!);
      if (msg) {
        turnPrefixMessages.push(msg);
      }
    }
  }
  const fileOps = extractFileOperations(
    prunedSummarize,
    pathEntries,
    prevCompactionIndex
  );
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }

  // §5.1: pin small user turns out of the summarize range — a user-stated
  // fact survives compaction verbatim rather than being summarized away.
  const { pinned: pinnedUserTurns, foldable: foldableMessages } =
    partitionPinnedTurns(prunedSummarize);

  return ok({
    firstKeptEntryId,
    messagesToSummarize: foldableMessages,
    pinnedUserTurns,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    pruneStats,
    settings,
  });
}

export { serializeConversation } from "./utils.ts";

/** Options for {@link compactEffect}. */
export interface CompactEffectOptions {
  readonly customInstructions?: string;
  readonly headers?: Record<string, string>;
  /** Required prompt bundle — caller supplies, no defaults. */
  readonly prompts: CompactionPrompts;
  readonly signal?: AbortSignal;
  readonly thinkingLevel?: ThinkingLevel;
}

/** Generate compaction summary data from prepared session history. */
export const compactEffect = (
  preparation: CompactionPreparation,
  model: Model,
  apiKey: string,
  opts: CompactEffectOptions
): Effect.Effect<Result<CompactionResult, CompactionError>> =>
  Effect.gen(function* () {
    const {
      firstKeptEntryId,
      messagesToSummarize,
      pinnedUserTurns,
      turnPrefixMessages,
      isSplitTurn,
      tokensBefore,
      previousSummary,
      fileOps,
      settings,
    } = preparation;

    if (!firstKeptEntryId) {
      return err(
        new CompactionError({
          code: "invalid_session",
          message: "First kept entry has no UUID - session may need migration",
        })
      );
    }

    let summary: string;

    if (isSplitTurn && turnPrefixMessages.length > 0) {
      const [historyResult, turnPrefixResult] = yield* Effect.all([
        messagesToSummarize.length > 0
          ? generateSummaryEffect(
              messagesToSummarize,
              model,
              settings.reserveTokens,
              apiKey,
              {
                ...(opts.headers === undefined
                  ? {}
                  : { headers: opts.headers }),
                ...(opts.signal === undefined ? {} : { signal: opts.signal }),
                ...(opts.customInstructions === undefined
                  ? {}
                  : { customInstructions: opts.customInstructions }),
                ...(previousSummary === undefined ? {} : { previousSummary }),
                ...(opts.thinkingLevel === undefined
                  ? {}
                  : { thinkingLevel: opts.thinkingLevel }),
                prompts: opts.prompts,
              }
            )
          : Effect.succeed(ok<string, CompactionError>("No prior history.")),
        generateTurnPrefixSummaryEffect(
          turnPrefixMessages,
          model,
          settings.reserveTokens,
          apiKey,
          {
            ...(opts.headers === undefined ? {} : { headers: opts.headers }),
            ...(opts.signal === undefined ? {} : { signal: opts.signal }),
            ...(opts.thinkingLevel === undefined
              ? {}
              : { thinkingLevel: opts.thinkingLevel }),
            prompts: opts.prompts,
          }
        ),
      ]);
      if (isFailure(historyResult)) {
        return err(historyResult.failure);
      }
      if (isFailure(turnPrefixResult)) {
        return err(turnPrefixResult.failure);
      }
      summary = `${historyResult.success}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.success}`;
    } else {
      const summaryResult = yield* generateSummaryEffect(
        messagesToSummarize,
        model,
        settings.reserveTokens,
        apiKey,
        {
          ...(opts.headers === undefined ? {} : { headers: opts.headers }),
          ...(opts.signal === undefined ? {} : { signal: opts.signal }),
          ...(opts.customInstructions === undefined
            ? {}
            : { customInstructions: opts.customInstructions }),
          ...(previousSummary === undefined ? {} : { previousSummary }),
          ...(opts.thinkingLevel === undefined
            ? {}
            : { thinkingLevel: opts.thinkingLevel }),
          prompts: opts.prompts,
        }
      );
      if (isFailure(summaryResult)) {
        return err(summaryResult.failure);
      }
      summary = summaryResult.success;
    }

    // §5.1: embed pinned user turns verbatim at the top of the summary.
    if (pinnedUserTurns.length > 0) {
      const pinnedBlock = renderPinnedTurns(pinnedUserTurns);
      summary = `${pinnedBlock}\n\n${summary}`;
    }

    const { readFiles, modifiedFiles } = computeFileLists(fileOps);
    summary += formatFileOperations(readFiles, modifiedFiles);

    return ok({
      summary,
      firstKeptEntryId,
      tokensBefore,
      details: { readFiles, modifiedFiles } as CompactionDetails,
    });
  });

/** @migration Promise wrapper — removes when callers migrate to Effect. */
export async function compact(
  ...args: Parameters<typeof compactEffect>
): Promise<Result<CompactionResult, CompactionError>> {
  return Effect.runPromise(compactEffect(...args));
}

interface TurnPrefixSummaryOptions {
  readonly headers?: Record<string, string>;
  readonly prompts: CompactionPrompts;
  readonly signal?: AbortSignal;
  readonly thinkingLevel?: ThinkingLevel;
}

const generateTurnPrefixSummaryEffect = (
  messages: AgentMessage[],
  model: Model,
  reserveTokens: number,
  apiKey: string,
  opts: TurnPrefixSummaryOptions
): Effect.Effect<Result<string, CompactionError>> =>
  Effect.gen(function* () {
    const maxTokens = Math.min(
      Math.floor(0.5 * reserveTokens),
      model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY
    );
    const llmMessages = convertToLlm(messages);
    const conversationText = serializeConversation(llmMessages);
    const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${opts.prompts.turnPrefix}`;
    const summarizationMessages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: promptText }],
        timestamp: Date.now(),
      },
    ];

    const response = yield* Effect.promise(() =>
      complete({
        model,
        messages: summarizationMessages,
        system: opts.prompts.summarizationSystem,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        ...(opts.signal ? { abortSignal: opts.signal } : {}),
        apiKey,
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(model.reasoning &&
        opts.thinkingLevel &&
        opts.thinkingLevel !== "off"
          ? { thinkingLevel: opts.thinkingLevel }
          : {}),
      })
    );
    if (response.finishReason === "error") {
      return err(
        new CompactionError({
          code: "summarization_failed",
          message: `Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`,
        })
      );
    }

    return ok(response.content.map((c) => c.text).join("\n"));
  });
