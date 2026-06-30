import {
  type ImageResizeOptions,
  type ResizedImage,
  resizeImageInProcess,
} from "./image-resize-core.ts";

export type { ImageResizeOptions, ResizedImage } from "./image-resize-core.ts";

/**
 * Resize an image to fit within the specified max dimensions and encoded size.
 * Returns null if the image cannot be resized below maxBytes or Photon is
 * unavailable. Runs Photon in-process.
 */
export async function resizeImage(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
  return resizeImageInProcess(inputBytes, mimeType, options);
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
