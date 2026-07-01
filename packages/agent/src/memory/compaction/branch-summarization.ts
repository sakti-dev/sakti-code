import type { Model } from "@sakti-code/llm";
import { complete } from "@sakti-code/llm";
import { Effect } from "effect";
import { estimateTokens } from "../compaction/compaction";
import {
  BranchSummaryError,
  type BranchSummaryResult,
  err,
  ok,
  type Result,
  SessionError,
  type SessionTreeEntry,
} from "../../harness-types";
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../../session/messages";
import type { SessionShape } from "../../session/session";
import type { AgentMessage } from "../../types";
import type { BranchSummaryPrompts } from "./prompt-bundles";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from "./utils.ts";

/** File-operation details stored on generated branch summary entries. */
export interface BranchSummaryDetails {
  /** Files modified while exploring the summarized branch. */
  modifiedFiles: string[];
  /** Files read while exploring the summarized branch. */
  readFiles: string[];
}

export type { FileOperations } from "./utils.ts";

/** Prepared branch content for summarization. */
export interface BranchPreparation {
  /** File operations extracted from the branch. */
  fileOps: FileOperations;
  /** Messages selected for the branch summary. */
  messages: AgentMessage[];
  /** Estimated token count for selected messages. */
  totalTokens: number;
}

/** Entries selected for branch summarization. */
export interface CollectEntriesResult {
  /** Deepest common ancestor between the previous leaf and target entry. */
  commonAncestorId: string | null;
  /** Entries to summarize in chronological order. */
  entries: SessionTreeEntry[];
}

/** Options for generating a branch summary. */
export interface GenerateBranchSummaryOptions {
  /** API key forwarded to the provider. */
  apiKey: string;
  /** Optional instructions appended to or replacing the default prompt. */
  customInstructions?: string;
  /** Optional request headers forwarded to the provider. */
  headers?: Record<string, string>;
  /** Model used for summarization. */
  model: Model;
  /** Required prompt bundle — caller supplies, no defaults. */
  prompts: BranchSummaryPrompts;
  /** Replace the default prompt with custom instructions instead of appending them. */
  replaceInstructions?: boolean;
  /** Tokens reserved for prompt and model output. Defaults to 16384. */
  reserveTokens?: number;
  /** Abort signal for the summarization request. */
  signal: AbortSignal;
}

/** Collect entries that should be summarized before navigating to a different session tree entry. */
export const collectEntriesForBranchSummaryEffect = (
  session: SessionShape,
  oldLeafId: string | null,
  targetId: string,
): Effect.Effect<CollectEntriesResult, SessionError> =>
  Effect.gen(function* () {
    if (!oldLeafId) {
      return { entries: [], commonAncestorId: null };
    }
    const oldPath = new Set(
      (yield* session.getBranch(oldLeafId)).map((e: SessionTreeEntry) => e.id),
    );
    const targetPath = yield* session.getBranch(targetId);
    let commonAncestorId: string | null = null;
    for (let i = targetPath.length - 1; i >= 0; i--) {
      if (oldPath.has(targetPath[i]!.id)) {
        commonAncestorId = targetPath[i]!.id;
        break;
      }
    }
    const entries: SessionTreeEntry[] = [];
    let current: string | null = oldLeafId;

    while (current && current !== commonAncestorId) {
      const entry: SessionTreeEntry | undefined = yield* session.getEntry(current);
      if (!entry) {
        return yield* new SessionError({
          code: "invalid_session",
          message: `Entry ${current} not found`,
        });
      }
      entries.push(entry as SessionTreeEntry);
      current = entry.parentId;
    }
    entries.reverse();

    return { entries, commonAncestorId };
  });

/** @migration Promise wrapper — removes when callers migrate to Effect. */
export async function collectEntriesForBranchSummary(
  session: SessionShape,
  oldLeafId: string | null,
  targetId: string,
): Promise<CollectEntriesResult> {
  return Effect.runPromise(collectEntriesForBranchSummaryEffect(session, oldLeafId, targetId));
}
function getMessageFromEntry(entry: SessionTreeEntry): AgentMessage | undefined {
  switch (entry.type) {
    case "message":
      if (entry.message.role === "toolResult") {
        return;
      }
      return entry.message;

    case "custom_message":
      return createCustomMessage(
        entry.customType,
        entry.content,
        entry.display,
        entry.details,
        entry.timestamp,
      );

    case "branch_summary":
      return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);

    case "compaction":
      return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
    case "thinking_level_change":
    case "model_change":
    case "active_tools_change":
    case "custom":
    case "label":
    case "session_info":
    case "leaf":
      return;
  }
}

/** Prepare branch entries for summarization within an optional token budget. */
export function prepareBranchEntries(
  entries: SessionTreeEntry[],
  tokenBudget = 0,
): BranchPreparation {
  const messages: AgentMessage[] = [];
  const fileOps = createFileOps();
  let totalTokens = 0;
  for (const entry of entries) {
    if (entry.type === "branch_summary" && !entry.fromHook && entry.details) {
      const details = entry.details as BranchSummaryDetails;
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
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const message = getMessageFromEntry(entry);
    if (!message) {
      continue;
    }
    extractFileOpsFromMessage(message, fileOps);

    const tokens = estimateTokens(message);
    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      if (
        (entry.type === "compaction" || entry.type === "branch_summary") &&
        totalTokens < tokenBudget * 0.9
      ) {
        messages.unshift(message);
        totalTokens += tokens;
      }
      break;
    }

    messages.unshift(message);
    totalTokens += tokens;
  }

  return { messages, fileOps, totalTokens };
}

/** Generate a summary for abandoned branch entries. */
export const generateBranchSummaryEffect = (
  entries: SessionTreeEntry[],
  options: GenerateBranchSummaryOptions,
): Effect.Effect<Result<BranchSummaryResult, BranchSummaryError>> =>
  Effect.gen(function* () {
    const {
      model,
      apiKey,
      headers,
      signal,
      customInstructions,
      replaceInstructions,
      reserveTokens = 16_384,
      prompts,
    } = options;
    const contextWindow = model.contextWindow || 128_000;
    const tokenBudget = contextWindow - reserveTokens;

    const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);

    if (messages.length === 0) {
      return ok({
        summary: "No content to summarize",
        readFiles: [],
        modifiedFiles: [],
      });
    }
    const llmMessages = convertToLlm(messages);
    const conversationText = serializeConversation(llmMessages);
    let instructions: string;
    if (replaceInstructions && customInstructions) {
      instructions = customInstructions;
    } else if (customInstructions) {
      instructions = `${prompts.prompt}\n\nAdditional focus: ${customInstructions}`;
    } else {
      instructions = prompts.prompt;
    }
    const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;

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
        system: prompts.systemPrompt,
        apiKey,
        ...(headers === undefined ? {} : { headers }),
        ...(signal ? { abortSignal: signal } : {}),
        maxOutputTokens: Math.min(model.maxTokens, 4096),
      }),
    );
    if (response.finishReason === "error") {
      return err(
        new BranchSummaryError({
          code: "summarization_failed",
          message: `Branch summary failed: ${response.errorMessage || "Unknown error"}`,
        }),
      );
    }

    let summary = response.content.map((c) => c.text).join("\n");
    summary = prompts.preamble + summary;
    const { readFiles, modifiedFiles } = computeFileLists(fileOps);
    summary += formatFileOperations(readFiles, modifiedFiles);

    return ok({
      summary: summary || "No summary generated",
      readFiles,
      modifiedFiles,
    });
  });

/** @migration Promise wrapper — removes when callers migrate to Effect. */
export async function generateBranchSummary(
  entries: SessionTreeEntry[],
  options: GenerateBranchSummaryOptions,
): Promise<Result<BranchSummaryResult, BranchSummaryError>> {
  return Effect.runPromise(generateBranchSummaryEffect(entries, options));
}
