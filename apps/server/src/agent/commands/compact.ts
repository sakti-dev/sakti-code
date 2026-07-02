import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  isFailure,
  PromiseSession,
  prepareCompaction,
} from "@sakti-code/agent";
import { Effect } from "effect";
import { COMPACTION_PROMPTS } from "../config/index.ts";
import { resolveAuth, resolveModel } from "../model-resolver.ts";
import type { ServerContext } from "../../context.ts";
import { createSessionStorage } from "../../context.ts";

export interface CompactResult {
  tokensBefore: number;
  summary: string;
  firstKeptEntryId: string;
}

export async function runCompact(
  ctx: ServerContext,
  sessionId: string,
  customInstructions?: string,
): Promise<CompactResult | { skipped: true } | { notFound: true } | { error: string }> {
  const log = ctx.log?.agent;
  const session = ctx.repos.sessions.findById(sessionId);
  if (!session) {
    log?.warn("runCompact: session not found", { sessionId });
    return { notFound: true };
  }

  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(ctx, session);
  } catch (e) {
    log?.warn("runCompact: model resolution failed", {
      sessionId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { error: `Model resolution failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const auth = resolveAuth(ctx, session);
  if (!auth) {
    log?.warn("runCompact: no API key", { sessionId, provider: model.provider });
    return { error: `No API key for ${model.provider} — add one in Settings > Models` };
  }

  const storage = createSessionStorage(ctx, sessionId);
  const entries = await Effect.runPromise(storage.getEntries());
  log?.info("runCompact: entries loaded", {
    sessionId,
    entryCount: entries.length,
    lastEntryType: entries.length > 0 ? entries[entries.length - 1]!.type : "none",
  });

  const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);

  if (isFailure(preparation)) {
    log?.warn("runCompact: prepareCompaction failed", {
      sessionId,
      error: preparation.failure.message,
    });
    return { error: preparation.failure.message };
  }
  if (!preparation.success) {
    log?.info("runCompact: nothing to compact (skipped)", {
      sessionId,
      entryCount: entries.length,
      reason: entries.length === 0 ? "empty" : "last-entry-is-compaction",
    });
    return { skipped: true };
  }

  const prep = preparation.success;
  log?.info("runCompact: compacting", {
    sessionId,
    tokensBefore: prep.tokensBefore,
    messagesToSummarize: prep.messagesToSummarize.length,
    firstKeptEntryId: prep.firstKeptEntryId,
  });

  const result = await compact(prep, auth.model, auth.apiKey, {
    prompts: COMPACTION_PROMPTS,
    ...(customInstructions !== undefined ? { customInstructions } : {}),
  });
  if (isFailure(result)) {
    log?.error("runCompact: compact LLM call failed", new Error(result.failure.message), {
      sessionId,
    });
    return { error: result.failure.message };
  }

  const sessionInstance = new PromiseSession(storage);
  await sessionInstance.appendCompaction(
    result.success.summary,
    result.success.firstKeptEntryId,
    result.success.tokensBefore,
    result.success.details,
  );

  log?.info("runCompact: done", {
    sessionId,
    tokensBefore: result.success.tokensBefore,
    summaryLength: result.success.summary.length,
  });

  return {
    tokensBefore: result.success.tokensBefore,
    summary: result.success.summary,
    firstKeptEntryId: result.success.firstKeptEntryId,
  };
}
