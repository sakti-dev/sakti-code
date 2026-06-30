import { describe, expect, it } from "vite-plus/test";
import { computeFileHash } from "../../../lib/hashline-utils/format";
import { InMemorySnapshotStore } from "../../../lib/hashline-utils/snapshots";
import { InMemoryFilesystem } from "../fs";
import { Patch } from "../input";
import { HEADTAIL_DRIFT_WARNING } from "../messages";
import { MismatchError } from "../mismatch";
import { Patcher } from "../patcher";

const PATH = "a.ts";

describe("Patcher construction", () => {
  it("requires a snapshot store at construction", () => {
    const fs = new InMemoryFilesystem();
    const options = { fs } as unknown as {
      fs: InMemoryFilesystem;
      snapshots: InMemorySnapshotStore;
    };

    expect(() => new Patcher(options)).toThrow(/requires a SnapshotStore/);
  });

  it("normalizes lowercase section tags while parsing", () => {
    const section = Patch.parseSingle("[a.ts#1a2b]\nSWAP 1.=1:\n+after");

    expect(section.fileHash).toBe("1A2B");
  });
});

describe("Patcher MismatchError message contracts", () => {
  it("refuses with mismatch when the recorded version no longer matches live content", async () => {
    const fs = new InMemoryFilesystem([[PATH, "drifted\n"]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, "before\n");
    const patcher = new Patcher({ fs, snapshots });

    try {
      await patcher.apply(Patch.parse(`[${PATH}#${tag}]\nSWAP 1.=1:\n+after`));
      throw new Error("expected MismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MismatchError);
      const message = (error as MismatchError).message;
      expect(message).toMatch(/file changed between read and edit/);
      expect(message).toMatch(/Section is bound to #/);
    }
    expect(fs.get(PATH)).toBe("drifted\n");
  });

  it("refuses with a 'not from this session' diagnostic when the tag was never recorded for this path", async () => {
    const fs = new InMemoryFilesystem([[PATH, "current\n"]]);
    const snapshots = new InMemorySnapshotStore();
    const patcher = new Patcher({ fs, snapshots });
    const live = computeFileHash("current\n");
    const bogus = live === "FFFF" ? "0000" : "FFFF";

    try {
      await patcher.apply(Patch.parse(`[${PATH}#${bogus}]\nSWAP 1.=1:\n+after`));
      throw new Error("expected MismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MismatchError);
      const message = (error as MismatchError).message;
      expect(message).toMatch(new RegExp(`hash #${bogus} is not from this session`));
      expect(message).toMatch(/never invent the tag/);
      expect(message).toMatch(/current file hashes to #[0-9A-F]{4}/);
    }
    expect(fs.get(PATH)).toBe("current\n");
  });
});

describe("MismatchError displayMessage", () => {
  const details = {
    path: "a.ts",
    expectedFileHash: "AAAA",
    actualFileHash: "BBBB",
    fileLines: ["x", "y"],
    anchorLines: [1],
    hashRecognized: true,
  };

  it("exposes a non-empty formatted displayMessage on an instance", () => {
    const err = new MismatchError(details);
    expect(err.displayMessage.length).toBeGreaterThan(0);
    expect(err.displayMessage).toMatch(/file changed between read and edit/);
    expect(err.displayMessage).toContain("a.ts");
  });

  it("formats a user-facing message via the static helper", () => {
    const message = MismatchError.formatDisplayMessage(details);
    expect(message.length).toBeGreaterThan(0);
    expect(message).toMatch(/file changed between read and edit/);
    expect(message).toContain("AAAA");
  });
});

describe("Patcher HEADTAIL_DRIFT_WARNING contract", () => {
  it("applies a head/tail insert with a stale tag and warns instead of hard-failing", async () => {
    const content = "a\nb\n";
    const fs = new InMemoryFilesystem([[PATH, content]]);
    const snapshots = new InMemorySnapshotStore();
    const live = computeFileHash(content);
    const stale = live === "0000" ? "FFFF" : "0000";
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[${PATH}#${stale}]\nINS.TAIL:\n+c`));

    const section = result.sections[0];
    expect(section?.op).toBe("update");
    expect(fs.get(PATH)).toBe("a\nb\nc\n");
    expect(section?.warnings).toContain(HEADTAIL_DRIFT_WARNING);
  });

  it("does not warn when a head/tail insert carries the live tag", async () => {
    const content = "a\nb\n";
    const fs = new InMemoryFilesystem([[PATH, content]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, content);
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[${PATH}#${tag}]\nINS.TAIL:\n+c`));

    const section = result.sections[0];
    expect(section?.op).toBe("update");
    expect(section?.warnings ?? []).not.toContain(HEADTAIL_DRIFT_WARNING);
  });
});

describe("Patcher seen-line provenance", () => {
  const CONTENT = "l1\nl2\nl3\nl4\nl5\n";

  it("rejects an edit anchored on a line the read never displayed", async () => {
    const fs = new InMemoryFilesystem([[PATH, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, CONTENT, [1, 2]);
    const patcher = new Patcher({ fs, snapshots });

    await expect(patcher.apply(Patch.parse(`[${PATH}#${tag}]\nSWAP 4.=4:\n+L4`))).rejects.toThrow(
      /never displayed \(it showed/,
    );
    expect(fs.get(PATH)).toBe(CONTENT);
  });

  it("applies an edit anchored on a displayed line", async () => {
    const fs = new InMemoryFilesystem([[PATH, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, CONTENT, [1, 2]);
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[${PATH}#${tag}]\nSWAP 2.=2:\n+L2`));

    expect(result.sections[0]?.op).toBe("update");
    expect(fs.get(PATH)).toBe("l1\nL2\nl3\nl4\nl5\n");
  });

  it("widens coverage when more of the same content is re-read (read fusion)", async () => {
    const fs = new InMemoryFilesystem([[PATH, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, CONTENT, [1, 2]);
    snapshots.record(PATH, CONTENT, [4, 5]);
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[${PATH}#${tag}]\nSWAP 4.=4:\n+L4`));

    expect(result.sections[0]?.op).toBe("update");
    expect(fs.get(PATH)).toBe("l1\nl2\nl3\nL4\nl5\n");
  });

  it("skips the check when no seen lines were recorded (absent → allow)", async () => {
    const fs = new InMemoryFilesystem([[PATH, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, CONTENT);
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[${PATH}#${tag}]\nSWAP 4.=4:\n+L4`));

    expect(result.sections[0]?.op).toBe("update");
  });
});

describe("Patcher tag-based path recovery", () => {
  const NESTED = "pkg/test/file.ts";
  const CONTENT = "one\ntwo\nthree\n";

  it("redirects a bare filename to the full path of the file its tag names", async () => {
    const fs = new InMemoryFilesystem([[NESTED, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(NESTED, CONTENT);
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[file.ts#${tag}]\nSWAP 2.=2:\n+TWO`));

    const section = result.sections[0];
    expect(section?.op).toBe("update");
    expect(section?.path).toBe(NESTED);
    expect(fs.get(NESTED)).toBe("one\nTWO\nthree\n");
    expect(
      section?.warnings.some(
        (warning) => warning.includes("does not exist") && warning.includes(NESTED),
      ),
    ).toBe(true);
  });

  it("declines recovery when the filename does not match the recorded file", async () => {
    const fs = new InMemoryFilesystem([[NESTED, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(NESTED, CONTENT);
    const patcher = new Patcher({ fs, snapshots });

    await expect(patcher.apply(Patch.parse(`[other.ts#${tag}]\nSWAP 2.=2:\n+TWO`))).rejects.toThrow(
      /File not found/,
    );
    expect(fs.get(NESTED)).toBe(CONTENT);
  });

  it("declines recovery when the tag matches no retained snapshot", async () => {
    const fs = new InMemoryFilesystem([[NESTED, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(NESTED, CONTENT);
    const bogus = tag === "FFFF" ? "0000" : "FFFF";
    const patcher = new Patcher({ fs, snapshots });

    await expect(
      patcher.apply(Patch.parse(`[file.ts#${bogus}]\nSWAP 2.=2:\n+TWO`)),
    ).rejects.toThrow(/File not found/);
  });

  it("declines recovery when two retained files share the filename and tag", async () => {
    const fs = new InMemoryFilesystem([
      ["a/file.ts", CONTENT],
      ["b/file.ts", CONTENT],
    ]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record("a/file.ts", CONTENT);
    snapshots.record("b/file.ts", CONTENT);
    const patcher = new Patcher({ fs, snapshots });

    await expect(patcher.apply(Patch.parse(`[file.ts#${tag}]\nSWAP 2.=2:\n+TWO`))).rejects.toThrow(
      /File not found/,
    );
    expect(fs.get("a/file.ts")).toBe(CONTENT);
    expect(fs.get("b/file.ts")).toBe(CONTENT);
  });

  it("respects a filesystem that refuses path recovery", async () => {
    class NoRecoveryFs extends InMemoryFilesystem {
      override allowTagPathRecovery(): boolean {
        return false;
      }
    }
    const fs = new NoRecoveryFs([[NESTED, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(NESTED, CONTENT);
    const patcher = new Patcher({ fs, snapshots });

    await expect(patcher.apply(Patch.parse(`[file.ts#${tag}]\nSWAP 2.=2:\n+TWO`))).rejects.toThrow(
      /File not found/,
    );
    expect(fs.get(NESTED)).toBe(CONTENT);
  });

  it("runs the write gate on the recovered path, not the authored bare path", async () => {
    class GatedFs extends InMemoryFilesystem {
      override async preflightWrite(p: string): Promise<void> {
        if (p === "file.ts") throw new Error("write gate: read-only");
      }
    }
    const fs = new GatedFs([[NESTED, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(NESTED, CONTENT);
    const patcher = new Patcher({ fs, snapshots });

    const result = await patcher.apply(Patch.parse(`[file.ts#${tag}]\nSWAP 2.=2:\n+TWO`));
    expect(result.sections[0]?.path).toBe(NESTED);
    expect(fs.get(NESTED)).toBe("one\nTWO\nthree\n");
  });

  it("runs the write gate on an unrecoverable authored path (gate wins over not-found)", async () => {
    class GatedFs extends InMemoryFilesystem {
      override async preflightWrite(): Promise<void> {
        throw new Error("write gate: read-only");
      }
    }
    const fs = new GatedFs([[NESTED, CONTENT]]);
    const snapshots = new InMemorySnapshotStore();
    const patcher = new Patcher({ fs, snapshots });

    await expect(patcher.apply(Patch.parse("[file.ts#ABCD]\nSWAP 1.=1:\n+X"))).rejects.toThrow(
      /write gate/,
    );
  });
});
