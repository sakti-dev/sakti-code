/**
 * Resize an image to fit within max dimensions and encoded base64 byte budget.
 *
 * Backed by `Bun.Image` (static libjpeg-turbo / spng / libwebp + Highway SIMD
 * resize). Strategy mirrors pi's Photon pipeline: try PNG and a ladder of
 * JPEG qualities at the target size; if still over budget, shrink dimensions
 * by 0.75x and retry until 1x1.
 */

export interface ImageResizeOptions {
  jpegQuality?: number; // Default: 80
  maxBytes?: number; // Default: 4.5MB of base64 payload (below Anthropic's 5MB limit)
  maxHeight?: number; // Default: 2000
  maxWidth?: number; // Default: 2000
}

export interface ResizedImage {
  data: string; // base64
  height: number;
  mimeType: string;
  originalHeight: number;
  originalWidth: number;
  wasResized: boolean;
  width: number;
}

// 4.5MB of base64 payload. Provides headroom below Anthropic's 5MB limit.
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: DEFAULT_MAX_BYTES,
  jpegQuality: 80,
};

interface EncodedCandidate {
  data: string;
  encodedSize: number;
  mimeType: string;
}

function isImageError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error;
}

/**
 * Resize an image to fit within the specified max dimensions and encoded size.
 * Returns null if the image cannot be resized below maxBytes.
 *
 * Uses Bun.Image (static libjpeg-turbo / spng / libwebp + Highway SIMD resize).
 * Decode/encode runs off-thread; this function does not block the event loop.
 */
export async function resizeImage(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: ImageResizeOptions
): Promise<ResizedImage | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const inputBase64Size = Math.ceil(inputBytes.byteLength / 3) * 4;

  let img: Bun.Image;
  try {
    img = new Bun.Image(inputBytes, { autoOrient: true });
  } catch {
    return null;
  }

  let originalWidth: number;
  let originalHeight: number;
  try {
    const meta = await img.metadata();
    originalWidth = meta.width;
    originalHeight = meta.height;
  } catch {
    return null;
  }

  // Fast path: already within all limits (dimensions AND encoded size).
  if (
    originalWidth <= opts.maxWidth &&
    originalHeight <= opts.maxHeight &&
    inputBase64Size < opts.maxBytes
  ) {
    return {
      data: Buffer.from(inputBytes).toString("base64"),
      mimeType: mimeType || "image/png",
      originalWidth,
      originalHeight,
      width: originalWidth,
      height: originalHeight,
      wasResized: false,
    };
  }

  // Shrink to fit max box preserving aspect ratio.
  let targetWidth = originalWidth;
  let targetHeight = originalHeight;
  if (targetWidth > opts.maxWidth) {
    targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
    targetWidth = opts.maxWidth;
  }
  if (targetHeight > opts.maxHeight) {
    targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
    targetHeight = opts.maxHeight;
  }

  async function tryEncodings(
    width: number,
    height: number,
    jpegQualities: number[],
    maxBytes: number
  ): Promise<EncodedCandidate | null> {
    let bestCandidate: EncodedCandidate | null = null;

    for (const quality of jpegQualities) {
      try {
        const data = await img
          .resize(width, height, { fit: "inside" })
          .jpeg({ quality })
          .toBase64();
        const candidate = {
          data,
          encodedSize: data.length,
          mimeType: "image/jpeg" as const,
        };
        if (candidate.encodedSize < maxBytes) {
          return candidate;
        }
        if (
          !bestCandidate ||
          candidate.encodedSize < bestCandidate.encodedSize
        ) {
          bestCandidate = candidate;
        }
      } catch {
        // skip
      }
    }

    for (const pngOpts of [
      { palette: true, colors: 64, dither: true },
      {},
    ] as const) {
      try {
        const data = await img
          .resize(width, height, { fit: "inside" })
          .png(pngOpts)
          .toBase64();
        const candidate = {
          data,
          encodedSize: data.length,
          mimeType: "image/png" as const,
        };
        if (candidate.encodedSize < maxBytes) {
          return candidate;
        }
        if (
          !bestCandidate ||
          candidate.encodedSize < bestCandidate.encodedSize
        ) {
          bestCandidate = candidate;
        }
      } catch (error: unknown) {
        if (isImageError(error) && error.code === "ERR_IMAGE_ENCODE_FAILED") {
          // continue
        }
      }
    }

    return bestCandidate;
  }

  const qualitySteps = Array.from(new Set([opts.jpegQuality, 85, 70, 55, 40]));
  let currentWidth = targetWidth;
  let currentHeight = targetHeight;

  while (true) {
    const candidate = await tryEncodings(
      currentWidth,
      currentHeight,
      qualitySteps,
      opts.maxBytes
    );

    if (candidate && candidate.encodedSize < opts.maxBytes) {
      return {
        data: candidate.data,
        mimeType: candidate.mimeType,
        originalWidth,
        originalHeight,
        width: currentWidth,
        height: currentHeight,
        wasResized: true,
      };
    }

    if (currentWidth === 1 && currentHeight === 1) {
      break;
    }

    const nextWidth =
      currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
    const nextHeight =
      currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
    if (nextWidth === currentWidth && nextHeight === currentHeight) {
      break;
    }

    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  return null;
}

/**
 * Format a dimension note for resized images.
 * Helps the model understand coordinate mapping back to the original.
 */
export function formatDimensionNote(result: ResizedImage): string | undefined {
  if (!result.wasResized) {
    return;
  }

  const scale = result.originalWidth / result.width;
  return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
