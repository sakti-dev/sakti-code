import { describe, expect, it } from "vite-plus/test";
import { parseDdgHtml } from "../ddg";

const HTML = [
  "<html><body><table>",
  '<tr><td><a class="result-link" href="https://a.example">Result A</a></td></tr>',
  '<tr><td class="result-snippet">Snippet A text</td></tr>',
  '<tr><td><a class="result-link" href="https://b.example">Result B</a></td></tr>',
  '<tr><td class="result-snippet">Snippet B</td></tr>',
  '<tr><td><a class="result-link" href="https://a.example">Result A again</a></td></tr>',
  '<tr><td class="result-snippet">dup</td></tr>',
  "</table></body></html>",
].join("");

describe("ddg parseDdgHtml", () => {
  it("extracts title/url/snippet pairs and dedupes by url", () => {
    expect(parseDdgHtml(HTML, 10)).toEqual([
      { title: "Result A", url: "https://a.example", snippet: "Snippet A text" },
      { title: "Result B", url: "https://b.example", snippet: "Snippet B" },
    ]);
  });

  it("caps at numResults", () => {
    expect(parseDdgHtml(HTML, 1)).toHaveLength(1);
  });

  it("returns [] for garbage/empty", () => {
    expect(parseDdgHtml("", 10)).toEqual([]);
    expect(parseDdgHtml("no results here", 10)).toEqual([]);
  });
});
