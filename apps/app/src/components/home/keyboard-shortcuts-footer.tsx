import {
  BiSolidDownArrow,
  BiSolidRightArrow,
  BiSolidUpArrow,
} from "solid-icons/bi";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

export function KeyboardShortcutsFooter() {
  return (
    <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-4 text-muted-foreground text-xs">
      <span class="flex items-center gap-1">
        <KbdGroup>
          <Kbd>
            <BiSolidUpArrow class="h-3 w-3" />
          </Kbd>
          <Kbd>
            <BiSolidDownArrow class="h-3 w-3" />
          </Kbd>
        </KbdGroup>
        <span>to navigate</span>
      </span>
      <span class="opacity-50">•</span>
      <span class="flex items-center gap-1">
        <Kbd>
          <BiSolidRightArrow class="h-3 w-3" />
        </Kbd>
        <span>to open</span>
      </span>
      <span class="opacity-50">•</span>
      <span class="flex items-center gap-1">
        <Kbd>Ctrl + F</Kbd>
        <span>to search</span>
      </span>
    </div>
  );
}
