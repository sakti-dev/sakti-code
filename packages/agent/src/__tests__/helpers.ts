import type { AgentEvent } from "../types.ts";

/**
 * Single-use mock async iterable for testing stream-based code.
 *
 * Throws on second iteration to surface infinite-loop bugs immediately
 * (real Node/Web streams are single-use linear consumers).
 */
export class MockEventStream<T = unknown> implements AsyncIterable<T> {
  private readonly events: T[] = [];
  private consumed = false;
  private _result?: unknown;

  push(event: T): void {
    this.events.push(event);
  }

  setResult(r: unknown): void {
    this._result = r;
  }

  result(): unknown {
    return this._result;
  }

  end(): void {
    // no-op for backward compat with tests that call end()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.consumed) {
      throw new Error(
        "MockEventStream already consumed. Use mockImplementation(() => factory()) instead of mockReturnValue(stream)."
      );
    }
    this.consumed = true;
    for (const e of this.events) {
      yield e;
    }
  }
}

/**
 * Collect all events from an async generator into an array.
 *
 * Includes a max-events safety cap to prevent OOM from infinite loops
 * (async generators that yield synchronously starve the macrotask queue,
 * so bun:test's test timeout never fires).
 */
export async function collectEvents(
  gen: AsyncIterable<AgentEvent>,
  maxEvents = 500
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
    if (events.length > maxEvents) {
      throw new Error(
        `collectEvents exceeded ${maxEvents} events — likely an infinite loop in the generator under test`
      );
    }
  }
  return events;
}
