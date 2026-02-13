export interface FrameBudgetRunResult {
  batches: number;
  yields: number;
  maxBatchMs: number;
  totalMs: number;
}

export interface FrameBudgetSchedulerOptions {
  frameBudgetMs: number;
}

function nowMs(): number {
  if (typeof performance === "undefined") return Date.now();
  return performance.now();
}

async function yieldToFrame(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return;
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

export async function runWithFrameBudget(
  step: () => boolean | Promise<boolean>,
  options: FrameBudgetSchedulerOptions
): Promise<FrameBudgetRunResult> {
  const totalStart = nowMs();
  let batches = 0;
  let yields = 0;
  let maxBatchMs = 0;

  let done = false;
  while (!done) {
    const batchStart = nowMs();
    do {
      // step returns true when all work is done
      done = await step();
      if (done) break;
    } while (nowMs() - batchStart < options.frameBudgetMs);

    const batchMs = nowMs() - batchStart;
    maxBatchMs = Math.max(maxBatchMs, batchMs);
    batches += 1;
    if (!done) {
      yields += 1;
      await yieldToFrame();
    }
  }

  return {
    batches,
    yields,
    maxBatchMs,
    totalMs: nowMs() - totalStart,
  };
}
