import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateArgs } from "../lib/shared.ts";
import type { ToolDefinition } from "../lib/types.ts";

const IMAGE_EXTENSIONS = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

function detectImageMime(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.get(ext) : undefined;
}

function sniffImageMime(buf: Buffer): string | undefined {
  if (buf.length < 4) {
    return;
  }
  // PNG: \x89PNG\r\n\x1a\n
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: \xff\xd8\xff
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: GIF8
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return;
}

export function createReadTool(cwd: string): ToolDefinition {
  return {
    name: "read",
    description: "Read file contents. Supports offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to cwd" },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed)",
        },
        limit: { type: "number", description: "Max lines to read" },
      },
      required: ["path"],
    },
    execute: async (_id, args) => {
      const v = validateArgs(
        args as Record<string, unknown>,
        {
          path: { type: "string", required: true },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        "read"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { path, offset, limit } = v.args as {
        path: string;
        offset?: number;
        limit?: number;
      };
      const filePath = resolve(cwd, path);

      if (!existsSync(filePath)) {
        return {
          content: `File not found: ${path}`,
          terminate: false,
          isError: true,
        };
      }

      let mime = detectImageMime(path);
      if (!mime) {
        // Sniff by magic bytes (first 12 bytes)
        const head = await readFile(filePath).then((b) => b.subarray(0, 12));
        mime = sniffImageMime(head);
      }
      if (mime) {
        const buf = await readFile(filePath);
        const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        return {
          content: `Read image file [${mime}]\n${dataUrl}`,
          terminate: false,
        };
      }

      const raw = await readFile(filePath, "utf-8");
      const lines = raw.split("\n");
      const maxLines = 2000;
      const maxBytes = 50 * 1024;

      const startLine = offset ? offset - 1 : 0;
      const endLine = limit ? startLine + limit : maxLines;
      const sliced = lines.slice(startLine, endLine);

      let content = sliced.join("\n");
      let truncated = false;

      if (lines.length > maxLines && !offset) {
        content = lines.slice(0, maxLines).join("\n");
        truncated = true;
      }

      if (Buffer.byteLength(content, "utf-8") > maxBytes) {
        content = content.slice(0, maxBytes);
        truncated = true;
      }

      if (truncated) {
        content += "\n\n[... truncated ...]";
      }

      return { content, terminate: false };
    },
  };
}
