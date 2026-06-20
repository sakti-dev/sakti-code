import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai/base";
import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { resolveReadPathAsync } from "../lib/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "../lib/truncate.ts";

const readSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to read (relative or absolute)",
  }),
  offset: Type.Optional(
    Type.Number({
      description: "Line number to start reading from (1-indexed)",
    })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of lines to read" })
  ),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

export interface ReadOperations {
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (
    absolutePath: string
  ) => Promise<string | null | undefined>;
  readFile: (absolutePath: string) => Promise<Buffer>;
}

const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

export interface ReadToolOptions {
  autoResizeImages?: boolean;
  operations?: ReadOperations;
}

async function detectSupportedImageMimeTypeFromFile(
  absolutePath: string
): Promise<string | null | undefined> {
  const ext = absolutePath.split(".").pop()?.toLowerCase();
  const IMAGE_EXTENSIONS = new Map([
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
  ]);
  const mime = ext ? IMAGE_EXTENSIONS.get(ext) : undefined;
  if (mime) {
    return mime;
  }

  const head = await fsReadFile(absolutePath).then((b) => b.subarray(0, 12));
  return sniffImageMime(head);
}

function sniffImageMime(buf: Buffer): string | undefined {
  if (buf.length < 4) {
    return;
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return "image/gif";
  }
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

export function createReadTool(
  cwd: string,
  options?: ReadToolOptions
): AgentTool<typeof readSchema, ReadToolDetails | undefined> {
  const autoResizeImages = options?.autoResizeImages ?? true;
  const ops = options?.operations ?? defaultReadOperations;
  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    async execute(
      _toolCallId,
      { path, offset, limit }: ReadToolInput,
      signal?: AbortSignal,
      _onUpdate?
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      let aborted = false;
      const onAbort = () => {
        aborted = true;
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const absolutePath = await resolveReadPathAsync(path, cwd);
      if (aborted) {
        throw new Error("Operation aborted");
      }
      await ops.access(absolutePath);
      if (aborted) {
        throw new Error("Operation aborted");
      }

      const mimeType = ops.detectImageMimeType
        ? await ops.detectImageMimeType(absolutePath)
        : undefined;
      let content: (TextContent | ImageContent)[];
      let details: ReadToolDetails | undefined;

      if (mimeType) {
        const buffer = await ops.readFile(absolutePath);
        if (aborted) {
          throw new Error("Operation aborted");
        }
        if (autoResizeImages) {
          const resized = await resizeImage(buffer, mimeType);
          if (resized) {
            const dimensionNote =
              resized.width && resized.height
                ? `${resized.width}x${resized.height}`
                : "";
            let textNote = `Read image file [${resized.mimeType}]`;
            if (dimensionNote) {
              textNote += `\n${dimensionNote}`;
            }
            content = [
              { type: "text", text: textNote },
              { type: "image", data: resized.data, mimeType: resized.mimeType },
            ];
          } else {
            content = [
              {
                type: "text",
                text: `Read image file [${mimeType}]\n[Image omitted: could not be resized below the inline image size limit.]`,
              },
            ];
          }
        } else {
          content = [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", data: buffer.toString("base64"), mimeType },
          ];
        }
      } else {
        const buffer = await ops.readFile(absolutePath);
        if (aborted) {
          throw new Error("Operation aborted");
        }
        const textContent = buffer.toString("utf-8");
        const allLines = textContent.split("\n");
        const totalFileLines = allLines.length;

        const startLine = offset ? Math.max(0, offset - 1) : 0;
        const startLineDisplay = startLine + 1;

        if (startLine >= allLines.length) {
          throw new Error(
            `Offset ${offset} is beyond end of file (${allLines.length} lines total)`
          );
        }

        let selectedContent: string;
        let userLimitedLines: number | undefined;

        if (limit === undefined) {
          selectedContent = allLines.slice(startLine).join("\n");
        } else {
          const endLine = Math.min(startLine + limit, allLines.length);
          selectedContent = allLines.slice(startLine, endLine).join("\n");
          userLimitedLines = endLine - startLine;
        }

        const truncation = truncateHead(selectedContent);
        let outputText: string;
        if (truncation.firstLineExceedsLimit) {
          const firstLineSize = formatSize(
            Buffer.byteLength(allLines[startLine]!, "utf-8")
          );
          outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
          details = { truncation };
        } else if (truncation.truncated) {
          const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
          const nextOffset = endLineDisplay + 1;
          outputText = truncation.content;
          if (truncation.truncatedBy === "lines") {
            outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
          } else {
            outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
          }
          details = { truncation };
        } else if (
          userLimitedLines !== undefined &&
          startLine + userLimitedLines < allLines.length
        ) {
          const remaining = allLines.length - (startLine + userLimitedLines);
          const nextOffset = startLine + userLimitedLines + 1;
          outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
        } else {
          outputText = truncation.content;
        }
        content = [{ type: "text", text: outputText }];
      }

      signal?.removeEventListener("abort", onAbort);
      return { content, details };
    },
  };
}

interface ResizedImage {
  data: string;
  height?: number;
  mimeType: string;
  width?: number;
}

async function resizeImage(
  buffer: Buffer,
  _mimeType: string
): Promise<ResizedImage | null> {
  const MAX_IMAGE_DIMENSION = 2000;
  try {
    const img = new Bun.Image(buffer);
    const width = img.width;
    const height = img.height;
    if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
      return {
        data: buffer.toString("base64"),
        mimeType: _mimeType,
        width,
        height,
      };
    }
    const resized = await img.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
      fit: "inside",
    });
    const pngBuffer = await resized.png().bytes();
    return {
      data: Buffer.from(pngBuffer).toString("base64"),
      mimeType: "image/png",
      width: resized.width,
      height: resized.height,
    };
  } catch {
    return null;
  }
}
