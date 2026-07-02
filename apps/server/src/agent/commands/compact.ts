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
  const session = ctx.repos.sessions.findById(sessionId);
  if (!session) {
    return { notFound: true };
  }

  let model: { model: ReturnType<typeof resolveModel>["model"]; provider: string };
  try {
    const resolved = resolveModel(ctx, session);
    model = resolved;
  } catch (e) {
    return { error: `Model resolution failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const auth = resolveAuth(ctx, session);
  if (!auth) {
    return { error: `No API key for ${model.provider} — add one in Settings > Models` };
  }

  const storage = createSessionStorage(ctx, sessionId);
  const entries = await Effect.runPromise(storage.getEntries());
  const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);

  if (isFailure(preparation)) {
    return { error: preparation.failure.message };
  }
  if (!preparation.success) {
    return { skipped: true };
  }

  const result = await compact(preparation.success, auth.model, auth.apiKey, {
    prompts: COMPACTION_PROMPTS,
    ...(customInstructions !== undefined ? { customInstructions } : {}),
  });
  if (isFailure(result)) {
    return { error: result.failure.message };
  }

  const sessionInstance = new PromiseSession(storage);
  await sessionInstance.appendCompaction(
    result.success.summary,
    result.success.firstKeptEntryId,
    result.success.tokensBefore,
    result.success.details,
  );

  return {
    tokensBefore: result.success.tokensBefore,
    summary: result.success.summary,
    firstKeptEntryId: result.success.firstKeptEntryId,
  };
}
