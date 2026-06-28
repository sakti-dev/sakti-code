import { describe, expect, it } from "vitest";
import { createStreamSimulator } from "../use-stream-simulator";

describe("stream simulator", () => {
  it("emits append snapshots in order", async () => {
    const simulator = createStreamSimulator({
      chunkSize: 2,
      content: "abcdef",
      mode: "append",
    });

    const snapshots = await simulator.collect();

    expect(snapshots).toEqual(["ab", "abcd", "abcdef"]);
  });

  it("emits rewrite-tail snapshots without resetting the whole transcript", async () => {
    const simulator = createStreamSimulator({
      chunkSize: 3,
      content: "abcdefghi",
      mode: "rewrite-tail",
    });

    const snapshots = await simulator.collect();

    expect(snapshots.length).toBe(3);
    expect(snapshots[0]).toBe("abc");
    expect(snapshots[1]).toContain("abcdef");
    expect(snapshots[2]).toContain("ghi");
    expect(snapshots[2]?.length).toBeGreaterThanOrEqual(
      snapshots[1]?.length ?? 0
    );
  });
});
