import { describe, expect, test } from "vite-plus/test";
import { isProtocolAllowed } from "../lib/protocol";

describe("isProtocolAllowed", () => {
  test.each([
    "http://x.io",
    "https://x.io",
    "mailto:a@b.io",
    "tel:12345",
    "ftp://x.io",
    "sftp://x.io",
  ])("allows %s", (url: string) => {
    expect(isProtocolAllowed(url)).toBe(true);
  });

  test.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "shell:foo",
    "://malformed",
    "not a url",
  ])("blocks %s", (url: string) => {
    expect(isProtocolAllowed(url)).toBe(false);
  });
});
