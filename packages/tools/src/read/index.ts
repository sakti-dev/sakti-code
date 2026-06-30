import { access as fsAccess, readFile as fsReadFile, open as openFile } from "node:fs/promises";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import type { ImageContent, TextContent } from "@sakti-code/llm";
import { type Static, Type } from "typebox";
import {
  computeFileHash,
  formatHashlineHeader,
  formatNumberedLines,
} from "../lib/hashline-utils/format.ts";
import { normalizeToLF } from "../lib/hashline-utils/normalize.ts";
import type { SnapshotStore } from "../lib/hashline-utils/snapshots.ts";
import { resolveReadPathAsync } from "../lib/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "../lib/truncate.ts";
import { formatDimensionNote, resizeImage } from "./image-resize.ts";
import { formatListPage, inspect, list, readText } from "./read-filesystem.ts";

const readSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to read (relative or absolute)",
  }),
  offset: Type.Optional(
    Type.Number({
      description: "Line number to start reading from (1-indexed)",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

export interface ReadOperations {
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
  readFile: (absolutePath: string) => Promise<Buffer>;
}

const defaultReadOperations: ReadOperations = {
  readFile: async (path) => fsReadFile(path),
  access: async (path) => {
    try {
      await fsAccess(path);
    } catch {
      throw new Error(`File not found: ${path}`);
    }
  },
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

export interface ReadToolOptions {
  autoResizeImages?: boolean;
  operations?: ReadOperations;
  snapshotStore?: SnapshotStore;
}

const IMAGE_TYPE_SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function detectSupportedImageMimeType(buffer: Uint8Array): string | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return buffer[3] === 0xf7 ? null : "image/jpeg";
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : null;
  }
  if (startsWithAscii(buffer, 0, "GIF")) {
    return "image/gif";
  }
  if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) {
    return "image/webp";
  }
  return null;
}

async function detectSupportedImageMimeTypeFromFile(
  filePath: string,
): Promise<string | null | undefined> {
  const handle = await openFile(filePath);
  try {
    const buffer = Buffer.alloc(IMAGE_TYPE_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, IMAGE_TYPE_SNIFF_BYTES, 0);
    return detectSupportedImageMimeType(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function isPng(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 16 &&
    readUint32BE(buffer, PNG_SIGNATURE.length) === 13 &&
    startsWithAscii(buffer, 12, "IHDR")
  );
}

function isAnimatedPng(buffer: Uint8Array): boolean {
  let offset: number = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const chunkLength = readUint32BE(buffer, offset);
    const chunkTypeOffset = offset + 4;
    if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) {
      return true;
    }
    if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) {
      return false;
    }

    const nextOffset = offset + 8 + chunkLength + 4;
    if (nextOffset <= offset || nextOffset > buffer.length) {
      return false;
    }
    offset = nextOffset;
  }
  return false;
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] ?? 0) * 0x1_00_00_00 +
    ((buffer[offset + 1] ?? 0) << 16) +
    ((buffer[offset + 2] ?? 0) << 8) +
    (buffer[offset + 3] ?? 0)
  );
}

function startsWith(buffer: Uint8Array, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Uint8Array, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) {
    return false;
  }
  for (let index = 0; index < text.length; index++) {
    if (buffer[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

const MAX_IMAGE_BASE64_BYTES = 4.5 * 1024 * 1024;

export function createReadTool(
  cwd: string,
  options?: ReadToolOptions,
): AgentTool<typeof readSchema, ReadToolDetails | undefined> {
  const ops = options?.operations ?? defaultReadOperations;
  return {
    name: "read",
    label: "read",
    description: `Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page. Supports images (jpg, png, gif, webp) sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files or directory pages. When you need the full file or directory, continue with offset until complete.`,
    parameters: readSchema,
    permissions: (params) => [{ permission: "read", patterns: [(params as ReadToolInput).path] }],
    async execute(
      _toolCallId: string,
      { path, offset, limit }: ReadToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<ReadToolDetails | undefined>,
    ): Promise<{
      content: (TextContent | ImageContent)[];
      details: ReadToolDetails | undefined;
    }> {
      const throwIfAborted = (): void => {
        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
      };

      throwIfAborted();
      const absolutePath = await resolveReadPathAsync(path, cwd);
      throwIfAborted();
      await ops.access(absolutePath);
      throwIfAborted();

      const type = await inspect(absolutePath);
      if (type === "directory") {
        const page = await list(
          absolutePath,
          offset !== undefined || limit !== undefined
            ? {
                ...(offset !== undefined ? { offset } : {}),
                ...(limit !== undefined ? { limit } : {}),
              }
            : undefined,
        );
        return {
          content: [
            {
              type: "text",
              text: formatListPage(page, {
                ...(offset !== undefined ? { offset } : {}),
                ...(limit !== undefined ? { limit } : {}),
              }),
            },
          ],
          details: undefined,
        };
      }

      const mimeType = ops.detectImageMimeType
        ? await ops.detectImageMimeType(absolutePath)
        : undefined;
      let content: (TextContent | ImageContent)[];

      if (mimeType) {
        const buffer = await ops.readFile(absolutePath);
        throwIfAborted();

        let imageContent: (TextContent | ImageContent)[];
        if (options?.autoResizeImages) {
          const resized = await resizeImage(buffer, mimeType);
          if (resized) {
            const dimensionNote = formatDimensionNote(resized);
            const textNote = dimensionNote
              ? `Read image file [${resized.mimeType}]\n${dimensionNote}`
              : `Read image file [${resized.mimeType}]`;
            imageContent = [
              { type: "text", text: textNote },
              {
                type: "image",
                data: resized.data,
                mimeType: resized.mimeType,
              },
            ];
          } else {
            imageContent = [
              {
                type: "text",
                text: `Read image file [${mimeType}]\n[Image omitted: could not be resized below the inline image size limit.]`,
              },
            ];
          }
        } else {
          const base64Data = buffer.toString("base64");
          const base64Size = Buffer.byteLength(base64Data, "utf-8");
          if (base64Size > MAX_IMAGE_BASE64_BYTES) {
            imageContent = [
              {
                type: "text",
                text: `Read image file [${mimeType}]\n[Image omitted: base64 payload (${formatSize(base64Size)}) exceeds ${formatSize(MAX_IMAGE_BASE64_BYTES)} limit. Enable autoResizeImages to downscale before sending.]`,
              },
            ];
          } else {
            imageContent = [
              { type: "text", text: `Read image file [${mimeType}]` },
              { type: "image", data: base64Data, mimeType },
            ];
          }
        }
        content = imageContent;
      } else {
        const textPage = await readText(
          absolutePath,
          offset !== undefined || limit !== undefined
            ? {
                ...(offset !== undefined ? { offset } : {}),
                ...(limit !== undefined ? { limit } : {}),
              }
            : undefined,
        );
        const hashline = !!options?.snapshotStore;
        let displayText = "";

        if (hashline) {
          const buffer = await ops.readFile(absolutePath);
          const textContent = buffer.toString("utf-8");
          const normalized = normalizeToLF(textContent);
          const fileHash = computeFileHash(normalized);
          const header = formatHashlineHeader(path, fileHash);
          const numbered = formatNumberedLines(textPage.content, textPage.offset);
          const outputLineCount = textPage.content.split("\n").length;
          const seenLines = new Set<number>();
          for (let i = 0; i < outputLineCount; i++) {
            seenLines.add(textPage.offset + i);
          }
          options!.snapshotStore!.record(absolutePath, normalized, seenLines);
          displayText = `${header}\n${numbered}`;
        } else {
          displayText = textPage.content;
        }

        content = [{ type: "text", text: displayText }];
      }

      throwIfAborted();
      return { content, details: undefined };
    },
  };
}
