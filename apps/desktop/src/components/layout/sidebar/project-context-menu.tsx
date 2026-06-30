import { onCleanup, onMount, type ParentComponent } from "solid-js";

export interface ProjectContextMenuProps {
  onClose: () => void;
  onCopyPath: (projectId: string) => void;
  onOpenInEditor: (projectId: string) => void;
  onOpenInTerminal: (projectId: string) => void;
  onRemove: (projectId: string) => void;
  projectId: string;
  projectName: string;
  x: number;
  y: number;
}

export const ProjectContextMenu: ParentComponent<ProjectContextMenuProps> = (props) => {
  // biome-ignore lint/suspicious/noUnassignedVariables: SolidJS ref pattern
  let menuRef: HTMLDivElement | undefined;

  const handleClick = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClick);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const handleAction = (action: () => void) => {
    action();
    props.onClose();
  };

  return (
    <div
      class="fixed z-[100] min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-lg"
      ref={menuRef}
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
    >
      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground text-xs transition-colors hover:bg-secondary"
        onClick={() => handleAction(() => props.onOpenInTerminal(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Open in Terminal</title>
          <path d="M2 4.25A2.25 2.25 0 0 1 4.25 2h7.5A2.25 2.25 0 0 1 14 4.25v7.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-7.5Zm3.03.47a.75.75 0 0 0-1.06 1.06L5.69 7.5 3.97 9.22a.75.75 0 1 0 1.06 1.06l2.25-2.25a.75.75 0 0 0 0-1.06L5.03 4.72ZM7.75 10a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" />
        </svg>
        Open in Terminal
      </button>

      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground text-xs transition-colors hover:bg-secondary"
        onClick={() => handleAction(() => props.onOpenInEditor(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Open in Editor</title>
          <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L3.22 10.303a1 1 0 0 0-.258.442l-.96 3.425a.25.25 0 0 0 .305.305l3.425-.96a1 1 0 0 0 .442-.258l7.79-7.79a1.75 1.75 0 0 0 0-2.475l-.476-.479z" />
        </svg>
        Open in Editor
      </button>

      <div class="my-1 border-border border-t" />

      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground text-xs transition-colors hover:bg-secondary"
        onClick={() => handleAction(() => props.onCopyPath(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Copy Path</title>
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9z" />
        </svg>
        Copy Path
      </button>

      <div class="my-1 border-border border-t" />

      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-destructive text-xs transition-colors hover:bg-destructive/10"
        onClick={() => handleAction(() => props.onRemove(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Remove Project</title>
          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
        </svg>
        Remove Project
      </button>
    </div>
  );
};
