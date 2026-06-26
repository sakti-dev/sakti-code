export class EventStream<T, R = T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private readonly finalResultPromise: Promise<R>;
  private resolveFinalResult!: (result: R) => void;
  private readonly isComplete: (event: T) => boolean;
  private readonly extractResult: (event: T) => R;

  constructor(
    isComplete: (event: T) => boolean,
    extractResult: (event: T) => R
  ) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  push(event: T): void {
    if (this.done) {
      return;
    }

    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  end(result?: R): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      if (!waiter) {
        break;
      }
      waiter({ value: undefined as unknown as T, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        const event = this.queue.shift();
        if (event !== undefined) {
          yield event;
        }
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) =>
          this.waiting.push(resolve)
        );
        if (result.done) {
          return;
        }
        yield result.value;
      }
    }
  }

  result(): Promise<R> {
    return this.finalResultPromise;
  }
}
