import { describe, expect, it } from "vite-plus/test";
import { webfetchTool } from "../webfetch.tsx";
import { websearchTool } from "../websearch.tsx";

describe("webfetchTool", () => {
  it("shows domain", () => {
    expect(
      webfetchTool.summary({ tool: "webfetch", args: { url: "https://example.com/page" } }),
    ).toBe("Fetched example.com");
  });
  it("falls back when url invalid", () => {
    expect(webfetchTool.summary({ tool: "webfetch", args: { url: "not a url" } })).toBe(
      "Fetched URL",
    );
  });
});

describe("websearchTool", () => {
  it("shows the query", () => {
    expect(
      websearchTool.summary({ tool: "websearch", args: { query: "solidjs reactivity" } }),
    ).toBe('Searched the web: "solidjs reactivity"');
  });
});
