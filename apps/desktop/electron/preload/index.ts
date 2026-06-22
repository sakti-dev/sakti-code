import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/channels";
import type { SaktiDesktopAPI } from "../shared/ipc-api";

const api: SaktiDesktopAPI = {
  server: {
    getConfig: () => ipcRenderer.invoke(IPC.getServerConfig),
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC.shellOpenExternal, url),
  },
};

contextBridge.exposeInMainWorld("sakti", api);
