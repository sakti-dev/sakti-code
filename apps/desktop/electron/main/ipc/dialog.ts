import { dialog } from "electron";

export function createDialogHooks(): {
  onOpenFolderDialog: () => Promise<string | null>;
} {
  return {
    async onOpenFolderDialog(): Promise<string | null> {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Project Directory",
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
  };
}
