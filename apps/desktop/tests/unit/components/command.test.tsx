import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandRoot,
  CommandSeparator,
} from "@/components/ui/command";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Command primitives", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders accessible roles and triggers selection", () => {
    const onSelect = vi.fn();
    const [query, setQuery] = createSignal("");

    ({ unmount: dispose } = render(
      () => (
        <CommandRoot>
          <CommandInput value={query()} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty hidden={true}>No results</CommandEmpty>
            <CommandGroup heading="Connected">
              <CommandItem value="zai/glm-4.7" onPick={onSelect}>
                GLM 4.7
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </CommandList>
        </CommandRoot>
      ),
      { container }
    ));

    const input = container.querySelector('input[role="combobox"]');
    const list = container.querySelector('[role="listbox"]');
    const item = container.querySelector('[role="option"]') as HTMLButtonElement;
    expect(input).toBeTruthy();
    expect(list).toBeTruthy();
    expect(item).toBeTruthy();

    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("zai/glm-4.7");
  });

  it("renders command dialog in a fixed overlay portal", () => {
    ({ unmount: dispose } = render(
      () => (
        <CommandDialog open={true}>
          <div>Dialog content</div>
        </CommandDialog>
      ),
      { container }
    ));

    expect(container.querySelector('[data-component="command-dialog-overlay"]')).toBeNull();
    const overlay = document.body.querySelector(
      '[data-component="command-dialog-overlay"]'
    ) as HTMLDivElement | null;
    expect(overlay).toBeTruthy();
    expect(overlay?.className).toContain("fixed");
    expect(overlay?.className).toContain("inset-0");
  });

  it("keeps command dialog mounted briefly for exit animation", async () => {
    vi.useFakeTimers();
    const [open, setOpen] = createSignal(true);

    ({ unmount: dispose } = render(
      () => (
        <CommandDialog open={open()}>
          <div data-testid="command-dialog-payload">Dialog content</div>
        </CommandDialog>
      ),
      { container }
    ));

    expect(document.body.querySelector('[data-testid="command-dialog-payload"]')).toBeTruthy();

    setOpen(false);
    expect(document.body.querySelector('[data-testid="command-dialog-payload"]')).toBeTruthy();

    await Promise.resolve();
    vi.runAllTimers();
    expect(document.body.querySelector('[data-testid="command-dialog-payload"]')).toBeNull();
    vi.useRealTimers();
  });
});
