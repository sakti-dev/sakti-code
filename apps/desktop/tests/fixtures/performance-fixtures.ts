import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface RecordedStreamFixture {
  chunks: string[];
}

const recordedFixtureCandidates = [
  path.resolve(process.cwd(), "tests/fixtures/recorded/chat-stream.from-log.json"),
  path.resolve(process.cwd(), "apps/desktop/tests/fixtures/recorded/chat-stream.from-log.json"),
];

function resolveRecordedFixturePath(): string | undefined {
  return recordedFixtureCandidates.find(candidate => existsSync(candidate));
}

function loadRecordedStreamFixture(): RecordedStreamFixture | undefined {
  const fixturePath = resolveRecordedFixturePath();
  if (!fixturePath) return undefined;

  const raw = readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;

  const first = parsed[0] as Partial<RecordedStreamFixture>;
  if (!Array.isArray(first.chunks)) return undefined;
  return { chunks: first.chunks };
}

export function createRecordedTextDeltaSequence(limit = 24): string[] {
  const fixture = loadRecordedStreamFixture();
  if (!fixture) {
    return ["I", "'ll", " explore", " the", " project"];
  }

  const deltas: string[] = [];
  for (const chunk of fixture.chunks) {
    const lines = chunk.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      try {
        const event = JSON.parse(payload) as Record<string, unknown>;
        if (event.type === "text-delta" && typeof event.delta === "string") {
          deltas.push(event.delta);
          if (deltas.length >= limit) return deltas;
        }
      } catch {
        // Ignore malformed lines in fixtures
      }
    }
  }

  return deltas;
}

export function accumulateDeltas(deltas: string[]): string {
  return deltas.join("");
}
