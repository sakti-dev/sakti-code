/**
 * Photon image processing wrapper (Node.js).
 *
 * Lazy-loads @silvia-odwyer/photon-node. Returns null if the WASM module cannot
 * be loaded so callers (image resize) degrade gracefully instead of throwing.
 */

export type { PhotonImage as PhotonImageType } from "@silvia-odwyer/photon-node";

let photonModule: typeof import("@silvia-odwyer/photon-node") | null = null;
let loadPromise: Promise<
  typeof import("@silvia-odwyer/photon-node") | null
> | null = null;

export async function loadPhoton(): Promise<
  typeof import("@silvia-odwyer/photon-node") | null
> {
  if (photonModule) {
    return photonModule;
  }
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    try {
      photonModule = await import("@silvia-odwyer/photon-node");
      return photonModule;
    } catch {
      photonModule = null;
      return photonModule;
    }
  })();
  return loadPromise;
}
