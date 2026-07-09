import { describe, expect, it } from "vite-plus/test";
import { extractPromptsFromEntries } from "../prompt-history.ts";

function row(content: unknown) {
  return { content: JSON.stringify(content) };
}

function userRow(text: string) {
  return row({
    id: "x",
    parentId: null,
    timestamp: "t",
    type: "message",
    message: { role: "user", content: text, timestamp: 0 },
  });
}

describe("extractPromptsFromEntries", () => {
  it("keeps only user messages, deduped, in the given (newest-first) order", () => {
    const rows = [userRow("hello"), userRow("world"), userRow("hello"), userRow("   ")];
    expect(extractPromptsFromEntries(rows)).toEqual(["hello", "world"]);
  });

  it("skips assistant and non-message entries", () => {
    const rows = [
      row({
        type: "message",
        message: { role: "assistant", content: "hi", timestamp: 0 },
      }),
      row({ type: "branch_summary", summary: "s" }),
    ];
    expect(extractPromptsFromEntries(rows)).toEqual([]);
  });

  it("extracts text from content-parts arrays", () => {
    const rows = [
      row({
        type: "message",
        message: {
          role: "user",
          content: [
            { type: "text", text: "part1" },
            { type: "text", text: "part2" },
          ],
          timestamp: 0,
        },
      }),
    ];
    expect(extractPromptsFromEntries(rows)).toEqual(["part1part2"]);
  });

  it("ignores malformed JSON rows", () => {
    expect(extractPromptsFromEntries([{ content: "{not json" }])).toEqual([]);
  });
});
