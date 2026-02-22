import { ArrowUpDown, CornerDownLeft } from "lucide-solid";

export function KeyboardShortcutsFooter() {
  return (
    <div
      class="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs"
      data-test="keyboard-shortcuts-footer"
    >
      <span class="flex items-center gap-1">
        <kbd class="bg-muted rounded px-1.5 py-0.5 text-xs font-medium">
          <ArrowUpDown class="h-3 w-3" />
        </kbd>
        <span>to navigate</span>
      </span>
      <span class="opacity-50">•</span>
      <span class="flex items-center gap-1">
        <kbd class="bg-muted rounded px-1.5 py-0.5 text-xs font-medium">
          <CornerDownLeft class="h-3 w-3" />
        </kbd>
        <span>to open</span>
      </span>
      <span class="opacity-50">•</span>
      <span class="flex items-center gap-1">
        <kbd class="bg-muted-foreground/20 rounded px-1.5 py-0.5 font-sans">⌘</kbd>
        <kbd class="bg-muted-foreground/20 rounded px-1.5 py-0.5 font-sans">F</kbd>
        <span>to search</span>
      </span>
      <span class="opacity-50">•</span>
      <span class="flex items-center gap-1">
        <kbd class="bg-muted-foreground/20 rounded px-1.5 py-0.5 font-sans">⌘</kbd>
        <kbd class="bg-muted-foreground/20 rounded px-1.5 py-0.5 font-sans">N</kbd>
        <span>new workspace</span>
      </span>
    </div>
  );
}
