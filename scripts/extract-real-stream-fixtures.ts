import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

interface ParsedLogLine extends JsonObject {
  package?: string;
  module?: string;
  msg?: string;
}

interface EventOrderingFixture {
  name: string;
  description: string;
  sessionId: string;
  events: Array<{
    type: string;
    properties: Record<string, unknown>;
    sessionID?: string;
    eventId: string;
    sequence: number;
    timestamp: number;
  }>;
  expectedBehavior: {
    userMessageVisible: boolean;
    assistantContentVisible: boolean;
    typingIndicatorVisible: boolean;
    hasError: boolean;
  };
}

interface StreamFixture {
  name: string;
  description: string;
  sessionId: string;
  messageId: string;
  chunks: string[];
}

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_LOG_PATH = path.join(ROOT, "logs/server-dev.log");
const OUT_DIR = path.join(ROOT, "apps/desktop/tests/fixtures/recorded");
const EVENTS_OUT = path.join(OUT_DIR, "event-ordering.from-log.json");
const STREAM_OUT = path.join(OUT_DIR, "chat-stream.from-log.json");

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readLines(filePath: string): ParsedLogLine[] {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const parsed: ParsedLogLine[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as ParsedLogLine);
    } catch {
      // Ignore non-JSON lines
    }
  }
  return parsed;
}

function inferSessionId(properties: Record<string, unknown>): string | null {
  if (typeof properties.sessionID === "string") return properties.sessionID;
  const info = asObject(properties.info);
  if (typeof info.sessionID === "string") return info.sessionID;
  const part = asObject(properties.part);
  if (typeof part.sessionID === "string") return part.sessionID;
  return null;
}

function extractEventFixtures(lines: ParsedLogLine[]): EventOrderingFixture[] {
  const bySession = new Map<string, EventOrderingFixture["events"]>();
  let fallbackTimestamp = Date.now();

  for (const line of lines) {
    if (line.package !== "bus" || line.msg !== "publishing payload") continue;
    const type = typeof line.type === "string" ? line.type : null;
    if (!type) continue;

    const properties = asObject(line.properties);
    const sessionID =
      (typeof line.sessionID === "string" ? line.sessionID : null) ??
      inferSessionId(properties) ??
      undefined;
    if (!sessionID) continue;

    const eventId = typeof line.eventId === "string" ? line.eventId : `evt-${Math.random()}`;
    const sequence = typeof line.sequence === "number" ? line.sequence : 0;
    const timestamp =
      typeof line.timestamp === "number"
        ? line.timestamp
        : typeof line.time === "number"
          ? line.time
          : fallbackTimestamp++;

    const events = bySession.get(sessionID) ?? [];
    events.push({
      type,
      properties,
      sessionID,
      eventId,
      sequence,
      timestamp,
    });
    bySession.set(sessionID, events);
  }

  const fixtures: EventOrderingFixture[] = [];
  for (const [sessionId, events] of bySession.entries()) {
    events.sort((a, b) => a.sequence - b.sequence);
    const userMessageVisible = events.some(event => {
      if (event.type !== "message.updated") return false;
      const info = asObject(event.properties.info);
      return info.role === "user";
    });
    const assistantContentVisible = events.some(event => {
      if (event.type !== "message.part.updated") return false;
      const part = asObject(event.properties.part);
      if (part.type === "text" && typeof part.text === "string") {
        return part.text.trim().length > 0;
      }
      return typeof part.type === "string";
    });
    const hasBusyStatus = events.some(event => {
      if (event.type !== "session.status") return false;
      const status = asObject(event.properties.status);
      return status.type === "busy";
    });
    const hasError = events.some(event => {
      if (event.type !== "message.part.updated") return false;
      const part = asObject(event.properties.part);
      return part.type === "error";
    });

    fixtures.push({
      name: `recorded-${sessionId.slice(0, 8)}`,
      description: `Recorded bus payload sequence for session ${sessionId}`,
      sessionId,
      events,
      expectedBehavior: {
        userMessageVisible,
        assistantContentVisible,
        typingIndicatorVisible: hasBusyStatus && !assistantContentVisible,
        hasError,
      },
    });
  }

  return fixtures;
}

function extractStreamFixtures(lines: ParsedLogLine[]): StreamFixture[] {
  const bySession = new Map<string, Array<{ event: Record<string, unknown>; order: number }>>();
  let order = 0;

  for (const line of lines) {
    if (line.package !== "server" || line.module !== "chat" || line.msg !== "stream event")
      continue;
    const sessionId = typeof line.sessionId === "string" ? line.sessionId : null;
    if (!sessionId) continue;

    const streamEventType =
      typeof line.streamEventType === "string" ? line.streamEventType : "unknown";
    const streamEventId = typeof line.streamEventId === "string" ? line.streamEventId : undefined;
    const entry: Record<string, unknown> = {
      type: streamEventType,
    };
    if (streamEventId) entry.id = streamEventId;
    if (typeof line.delta === "string") entry.delta = line.delta;
    if (typeof line.finishReason === "string") entry.finishReason = line.finishReason;
    if (line.data !== undefined) entry.data = line.data;
    if (typeof line.errorText === "string") entry.error = line.errorText;

    const events = bySession.get(sessionId) ?? [];
    events.push({ event: entry, order: order++ });
    bySession.set(sessionId, events);
  }

  const fixtures: StreamFixture[] = [];
  for (const [sessionId, entries] of bySession.entries()) {
    entries.sort((a, b) => a.order - b.order);
    const chunks = entries.map(entry => `data: ${JSON.stringify(entry.event)}\n\n`);
    const firstMessageEvent = entries.find(entry => typeof entry.event.id === "string");
    const messageId =
      (firstMessageEvent?.event.id as string | undefined) ?? `${sessionId}-assistant`;

    fixtures.push({
      name: `recorded-stream-${sessionId.slice(0, 8)}`,
      description: `Recorded chat stream events for session ${sessionId}`,
      sessionId,
      messageId,
      chunks,
    });
  }

  return fixtures;
}

function main() {
  const logPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_LOG_PATH;
  const lines = readLines(logPath);
  const eventFixtures = extractEventFixtures(lines);
  const streamFixtures = extractStreamFixtures(lines);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(EVENTS_OUT, `${JSON.stringify(eventFixtures, null, 2)}\n`, "utf8");
  writeFileSync(STREAM_OUT, `${JSON.stringify(streamFixtures, null, 2)}\n`, "utf8");

  console.log(
    `Extracted ${eventFixtures.length} event fixtures and ${streamFixtures.length} stream fixtures from ${logPath}`
  );
  if (eventFixtures.length === 0) {
    console.log(
      "No bus payload fixtures were extracted. Start dev with SAKTI_CODE_LOG_BUS_EVENT_PAYLOADS=true and re-run."
    );
  }
  if (streamFixtures.length === 0) {
    console.log(
      "No chat stream fixtures were extracted. Start dev with SAKTI_CODE_LOG_CHAT_STREAM_EVENTS=true and re-run."
    );
  }
}

main();
