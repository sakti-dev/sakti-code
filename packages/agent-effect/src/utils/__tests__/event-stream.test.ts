import { describe, expect, it } from "vitest";
import { EventStream } from "../event-stream.ts";

describe("EventStream", () => {
  it("delivers pushed events in order", async () => {
    const stream = new EventStream<number, number[]>(
      (event) => event < 0,
      () => []
    );

    stream.push(1);
    stream.push(2);
    stream.push(-1);

    const events: number[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([1, 2, -1]);
  });

  it("supports async iteration after all events are pushed", async () => {
    const stream = new EventStream<number, number[]>(
      (event) => event < 0,
      () => []
    );

    stream.push(1);
    stream.push(2);
    stream.end();

    const events: number[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([1, 2]);
  });

  it("provides final result via result() promise", async () => {
    const stream = new EventStream<string, string>(
      (event) => event === "done",
      (event) => `result: ${event}`
    );

    stream.push("step1");
    stream.push("done");

    const result = await stream.result();
    expect(result).toBe("result: done");
  });

  it("ignores events after end", async () => {
    const stream = new EventStream<number, number>(
      (event) => event === 99,
      (event) => event
    );

    stream.push(1);
    stream.end(42);
    stream.push(99); // should be ignored

    const events: number[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([1]);
    expect(await stream.result()).toBe(42);
  });

  it("error() rejects the result() promise", async () => {
    const stream = new EventStream<number, number>(
      (event) => event < 0,
      () => 0
    );
    const boom = new Error("kaboom");
    stream.push(1);
    stream.error(boom);
    await expect(stream.result()).rejects.toBe(boom);
  });

  it("error() throws in async iteration (drains waiting consumers)", async () => {
    const stream = new EventStream<number, number>(
      (event) => event < 0,
      () => 0
    );
    const boom = new Error("kaboom");

    const consume = async () => {
      const events: number[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      return events;
    };

    const consumerPromise = consume();
    // Let the consumer enter the waiting state
    await Promise.resolve();
    stream.error(boom);

    await expect(consumerPromise).rejects.toBe(boom);
  });

  it("error() throws for queued events not yet consumed", async () => {
    const stream = new EventStream<number, number>(
      (event) => event < 0,
      () => 0
    );
    const boom = new Error("kaboom");

    stream.push(1);
    stream.error(boom);

    const consume = async () => {
      const events: number[] = [];
      for await (const event of stream) {
        events.push(event);
      }
    };
    await expect(consume()).rejects.toBe(boom);
  });

  it("error() ignores subsequent pushes", async () => {
    const stream = new EventStream<number, number>(
      (event) => event < 0,
      () => 0
    );
    const boom = new Error("kaboom");

    stream.error(boom);
    stream.push(1); // should be ignored

    await expect(stream.result()).rejects.toBe(boom);
  });
});
