export interface MarkdownStreamQueue {
  stream: () => AsyncGenerator<string>;
  push: (chunk: string) => void;
  close: () => void;
  reset: () => void;
}

export function createMarkdownStreamQueue(): MarkdownStreamQueue {
  const pending: string[] = [];
  let done = false;
  let notify: (() => void) | null = null;
  let generation = 0;

  async function* stream(): AsyncGenerator<string> {
    const localGeneration = generation;
    while (localGeneration === generation) {
      while (pending.length > 0) {
        const next = pending.shift();
        if (next !== undefined) yield next;
      }
      if (done) return;
      await new Promise<void>(resolve => {
        notify = resolve;
      });
      notify = null;
    }
  }

  return {
    stream,
    push: chunk => {
      if (done || !chunk) return;
      pending.push(chunk);
      notify?.();
    },
    close: () => {
      done = true;
      notify?.();
    },
    reset: () => {
      generation += 1;
      pending.length = 0;
      done = false;
      notify?.();
    },
  };
}
