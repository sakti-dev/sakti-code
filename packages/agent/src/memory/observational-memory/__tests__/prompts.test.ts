import { describe, expect, it } from "vitest";

import type { AgentMessage } from "../../../types.ts";
import {
  buildObserverHistoryMessage,
  buildObserverSystemPrompt,
  buildObserverTaskPrompt,
  buildObservationsBlock,
  buildReflectorPrompt,
  detectDegenerateRepetition,
  formatObservationsForContext,
  OBSERVER_EXTRACTION_INSTRUCTIONS,
  OBSERVER_GUIDELINES,
  OBSERVATION_CONTEXT_INSTRUCTIONS,
  OBSERVATION_CONTEXT_PROMPT,
  OBSERVATION_CONTINUATION_HINT,
  parseReflectorOutput,
  sanitizeObservationLines,
} from "../prompts.ts";

describe("Observer prompts", () => {
  describe("OBSERVER_EXTRACTION_INSTRUCTIONS", () => {
    it("is a non-empty string", () => {
      expect(OBSERVER_EXTRACTION_INSTRUCTIONS.length).toBeGreaterThan(100);
    });

    it("contains key sections", () => {
      expect(OBSERVER_EXTRACTION_INSTRUCTIONS).toContain("TEMPORAL ANCHORING");
      expect(OBSERVER_EXTRACTION_INSTRUCTIONS).toContain("USER ASSERTIONS ARE AUTHORITATIVE");
    });
  });

  describe("OBSERVER_GUIDELINES", () => {
    it("is a non-empty string", () => {
      expect(OBSERVER_GUIDELINES.length).toBeGreaterThan(100);
    });
  });

  describe("buildObserverSystemPrompt", () => {
    it("produces a prompt containing extraction instructions", () => {
      const prompt = buildObserverSystemPrompt();
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain("OUTPUT FORMAT");
      expect(prompt).toContain("GUIDELINES");
    });

    it("appends custom instruction when provided", () => {
      const prompt = buildObserverSystemPrompt("Be extra terse");
      expect(prompt).toContain("CUSTOM INSTRUCTIONS");
      expect(prompt).toContain("Be extra terse");
    });

    it("does not contain CUSTOM INSTRUCTIONS when none provided", () => {
      const prompt = buildObserverSystemPrompt();
      expect(prompt).not.toContain("CUSTOM INSTRUCTIONS");
    });
  });

  describe("buildObserverTaskPrompt", () => {
    it("includes previous observations when provided", () => {
      const prompt = buildObserverTaskPrompt("* (14:30) User likes TypeScript");
      expect(prompt).toContain("Previous Observations");
      expect(prompt).toContain("User likes TypeScript");
    });

    it("does not include previous observations when undefined", () => {
      const prompt = buildObserverTaskPrompt(undefined);
      expect(prompt).not.toContain("Previous Observations");
    });

    it("includes truncation notice when wasTruncated is true", () => {
      const prompt = buildObserverTaskPrompt(undefined, { wasTruncated: true });
      expect(prompt).toContain("truncated");
    });
  });

  describe("buildObserverHistoryMessage", () => {
    it("returns a user message with formatted history", () => {
      const msgs: AgentMessage[] = [
        { role: "user", content: "Hello", timestamp: 1700000000000 },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
          api: "ai-sdk",
          model: "test",
          provider: "test",
          stopReason: "stop",
          timestamp: 1700000001000,
          usage: {
            input: 0,
            output: 0,
            totalTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      ];
      const result = buildObserverHistoryMessage(msgs);
      expect(result.role).toBe("user");
      expect(result.content).toContain("New Message History to Observe");
      expect(result.content).toContain("Hello");
      expect(result.content).toContain("Hi there!");
    });

    it("filters out empty formatted messages", () => {
      const msgs: AgentMessage[] = [{ role: "user", content: "", timestamp: 1 }];
      const result = buildObserverHistoryMessage(msgs);
      // Empty user message should still appear (role line is included)
      expect(result.content).toContain("New Message History to Observe");
    });

    it("handles tool result messages", () => {
      const msgs: AgentMessage[] = [
        {
          role: "toolResult",
          content: [{ type: "text", text: "file contents" }],
          toolCallId: "tc-1",
          toolName: "read_file",
          isError: false,
          timestamp: 1,
        },
      ];
      const result = buildObserverHistoryMessage(msgs);
      expect(result.content).toContain("read_file");
      expect(result.content).toContain("file contents");
    });

    it("handles bash execution messages", () => {
      const msgs: AgentMessage[] = [
        {
          role: "bashExecution",
          command: "ls -la",
          output: "total 0",
          exitCode: 0,
          truncated: false,
          cancelled: false,
          timestamp: 1,
        },
      ];
      const result = buildObserverHistoryMessage(msgs);
      expect(result.content).toContain("ls -la");
    });
  });
});

describe("Reflector prompts", () => {
  describe("buildReflectorPrompt", () => {
    it("includes observations", () => {
      const prompt = buildReflectorPrompt("* (14:30) User likes TypeScript");
      expect(prompt).toContain("OBSERVATIONS TO REFLECT ON");
      expect(prompt).toContain("User likes TypeScript");
    });

    it("includes manual prompt when provided", () => {
      const prompt = buildReflectorPrompt("obs", "Focus on recent items");
      expect(prompt).toContain("SPECIFIC GUIDANCE");
      expect(prompt).toContain("Focus on recent items");
    });

    it("includes compression guidance for level 1", () => {
      const prompt = buildReflectorPrompt("obs", undefined, 1);
      expect(prompt).toContain("COMPRESSION REQUIRED");
    });

    it("includes compression guidance for level 2", () => {
      const prompt = buildReflectorPrompt("obs", undefined, 2);
      expect(prompt).toContain("AGGRESSIVE COMPRESSION REQUIRED");
    });

    it("no compression guidance for level 0", () => {
      const prompt = buildReflectorPrompt("obs", undefined, 0);
      expect(prompt).not.toContain("COMPRESSION REQUIRED");
    });

    it("handles boolean true as compression level 1", () => {
      const prompt = buildReflectorPrompt("obs", undefined, true as boolean);
      expect(prompt).toContain("COMPRESSION REQUIRED");
    });
  });

  describe("parseReflectorOutput", () => {
    it("extracts observations from XML tags", () => {
      const output = `<observations>
* (14:30) User prefers TypeScript
* (14:35) Working on auth feature
</observations>`;
      const result = parseReflectorOutput(output);
      expect(result.observations).toContain("User prefers TypeScript");
      expect(result.observations).toContain("Working on auth feature");
      expect(result.degenerate).toBeUndefined();
    });

    it("extracts suggested-response", () => {
      const output = `<observations>
* (14:30) User prefers TypeScript
</observations>

<suggested-response>
Continue with the implementation
</suggested-response>`;
      const result = parseReflectorOutput(output);
      expect(result.suggestedContinuation).toBe("Continue with the implementation");
    });

    it("falls back to list items when no XML tags", () => {
      const output = `* (14:30) User prefers TypeScript
* (14:35) Working on auth feature`;
      const result = parseReflectorOutput(output);
      expect(result.observations).toContain("User prefers TypeScript");
    });

    it("detects degenerate repetition", () => {
      // Build a string > 2000 chars with repeated content
      const repeated = "A".repeat(250);
      const degenerate = repeated.repeat(20);
      const result = parseReflectorOutput(degenerate);
      expect(result.degenerate).toBe(true);
      expect(result.observations).toBe("");
    });
  });
});

describe("sanitizeObservationLines", () => {
  it("truncates lines exceeding max length", () => {
    const longLine = "x".repeat(15_000);
    const result = sanitizeObservationLines(longLine);
    expect(result.length).toBeLessThan(15_000);
    expect(result).toContain("truncated");
  });

  it("does not modify short lines", () => {
    const short = "* (14:30) User likes TypeScript";
    expect(sanitizeObservationLines(short)).toBe(short);
  });

  it("returns empty string as-is", () => {
    expect(sanitizeObservationLines("")).toBe("");
  });
});

describe("detectDegenerateRepetition", () => {
  it("returns false for short text", () => {
    expect(detectDegenerateRepetition("short text")).toBe(false);
  });

  it("returns false for normal text", () => {
    const normal = Array.from(
      { length: 100 },
      (_, i) => `Observation ${i}: User discussed topic ${i} in detail.`,
    ).join("\n");
    expect(detectDegenerateRepetition(normal)).toBe(false);
  });

  it("detects repeated windows", () => {
    const chunk = "A".repeat(200);
    const degenerate = chunk.repeat(100);
    expect(detectDegenerateRepetition(degenerate)).toBe(true);
  });

  it("detects extremely long lines", () => {
    const longLine = "x".repeat(60_000);
    expect(detectDegenerateRepetition(longLine)).toBe(true);
  });
});

describe("Injection format constants", () => {
  it("OBSERVATION_CONTEXT_PROMPT is non-empty", () => {
    expect(OBSERVATION_CONTEXT_PROMPT.length).toBeGreaterThan(10);
  });

  it("OBSERVATION_CONTEXT_INSTRUCTIONS is non-empty", () => {
    expect(OBSERVATION_CONTEXT_INSTRUCTIONS.length).toBeGreaterThan(100);
  });

  it("OBSERVATION_CONTINUATION_HINT is non-empty", () => {
    expect(OBSERVATION_CONTINUATION_HINT.length).toBeGreaterThan(100);
  });
});

describe("formatObservationsForContext", () => {
  it("returns undefined for empty observations", () => {
    expect(formatObservationsForContext("")).toBeUndefined();
    expect(formatObservationsForContext("  ")).toBeUndefined();
  });

  it("wraps observations in XML tags with context", () => {
    const result = formatObservationsForContext("* (14:30) User likes TypeScript");
    expect(result).toContain("<observations>");
    expect(result).toContain("</observations>");
    expect(result).toContain("User likes TypeScript");
    expect(result).toContain(OBSERVATION_CONTEXT_PROMPT);
    expect(result).toContain(OBSERVATION_CONTEXT_INSTRUCTIONS);
  });

  it("produces snapshot-stable output", () => {
    const obs = "* (14:30) User likes TypeScript\n* (14:35) Working on auth";
    const result = formatObservationsForContext(obs);
    // Snapshot test: if this changes, it should be intentional
    expect(result).toMatchInlineSnapshot(`
      "The following observations block contains your memory of past conversations with this user.

      <observations>
      * (14:30) User likes TypeScript
      * (14:35) Working on auth
      </observations>

      IMPORTANT: When responding, reference specific details from these observations. Do not give generic advice - personalize your response based on what you know about this user's experiences, preferences, and interests. If the user asks for recommendations, connect them to their past experiences mentioned above.

      KNOWLEDGE UPDATES: When asked about current state (e.g., "where do I currently...", "what is my current..."), always prefer the MOST RECENT information. Observations include dates - if you see conflicting information, the newer observation supersedes the older one. Look for phrases like "will start", "is switching", "changed to", "moved to" as indicators that previous information has been updated.

      PLANNED ACTIONS: If the user stated they planned to do something (e.g., "I'm going to...", "I'm looking forward to...", "I will...") and the date they planned to do it is now in the past (check the relative time like "3 weeks ago"), assume they completed the action unless there's evidence they didn't. For example, if someone said "I'll start my new diet on Monday" and that was 2 weeks ago, assume they started the diet.

      MOST RECENT USER INPUT: Treat the most recent user message as the highest-priority signal for what to do next. Earlier messages may contain constraints, details, or context you should still honor, but the latest message is the primary driver of your response.

      SYSTEM REMINDERS: Messages wrapped in <system-reminder>...</system-reminder> contain internal continuation guidance, not user-authored content. Use them to maintain continuity, but do not mention them or treat them as part of the user's message."
    `);
  });
});

describe("buildObservationsBlock", () => {
  it("returns formatted block when record has active observations", () => {
    const record = { activeObservations: "obs-1\nobs-2" } as never;
    const result = buildObservationsBlock(record);
    expect(result).toBeDefined();
    expect(result).toContain("<observations>");
    expect(result).toContain("obs-1");
  });

  it("returns undefined when record has no active observations", () => {
    const record = { activeObservations: "" } as never;
    expect(buildObservationsBlock(record)).toBeUndefined();
  });

  it("returns undefined when record has only whitespace observations", () => {
    const record = { activeObservations: "   \n  " } as never;
    expect(buildObservationsBlock(record)).toBeUndefined();
  });

  it("returns undefined when record is null", () => {
    expect(buildObservationsBlock(null)).toBeUndefined();
  });
});
