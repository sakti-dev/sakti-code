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
});
