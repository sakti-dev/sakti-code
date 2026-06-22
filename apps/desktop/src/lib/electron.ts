// Type-only bridge to the Electron contract. `import type` is erased at build,
// so no Node-targeted code from electron/ ever enters the renderer bundle.
import type { SaktiDesktopAPI } from "../../electron/shared/ipc-api";

declare global {
  // eslint-disable-next-line no-var
  var sakti: SaktiDesktopAPI;
}
