import { describe, expect, it } from "vitest";
import { InMemorySnapshotStore } from "../../../lib/hashline-utils/snapshots";
import { RECOVERY_SESSION_REPLAY_WARNING } from "../messages";
import { parsePatch } from "../parser";
import { Recovery } from "../recovery";

const PATH = "/tmp/__hashline-recovery-session-chain__.ts";

function seedTwoSnapshots(): {
  store: InMemorySnapshotStore;
  v0Text: string;
  v1Text: string;
  h0: string;
  h1: string;
} {
  const store = new InMemorySnapshotStore();
  const v0Lines = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"];
  const v1Lines = [...v0Lines];
  v1Lines[4] = "L5-CHANGED";
  const v0Text = `${v0Lines.join("\n")}\n`;
  const v1Text = `${v1Lines.join("\n")}\n`;
  const h0 = store.record(PATH, v0Text);
  const h1 = store.record(PATH, v1Text);
  return { store, v0Text, v1Text, h0, h1 };
}

describe("Recovery — session-chain replay anchor-content gate", () => {
  it("refuses replay when an edit anchor's line content diverges between snapshot and current", () => {
    const { store, v1Text, h0 } = seedTwoSnapshots();
    const { edits } = parsePatch("SWAP 5.=5:\n|L5-MODEL");

    const recovered = new Recovery(store).tryRecover({
      path: PATH,
      currentText: v1Text,
      fileHash: h0,
      edits,
    });

    expect(recovered).toBeNull();
  });

  it("replays edits onto current when every anchor's line content is unchanged", () => {
    const { store, v1Text, h0 } = seedTwoSnapshots();
    const { edits } = parsePatch("SWAP 3.=3:\n|L3-MODEL");

    const recovered = new Recovery(store).tryRecover({
      path: PATH,
      currentText: v1Text,
      fileHash: h0,
      edits,
    });

    expect(recovered).not.toBeNull();
    expect(recovered?.text).toContain("L3-MODEL");
    expect(recovered?.text).toContain("L5-CHANGED");
    expect(recovered?.warnings).toContain(RECOVERY_SESSION_REPLAY_WARNING);
  });
});
