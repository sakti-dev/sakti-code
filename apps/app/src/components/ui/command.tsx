import * as DialogPrimitive from "@kobalte/core/dialog";
import { createPresence } from "@solid-primitives/presence";
import { FiSearch } from "solid-icons/fi";
import type { Component, ComponentProps, JSX, ParentComponent } from "solid-js";
import { Show, splitProps } from "solid-js";
import "./command.css";
import { cn } from "~/lib/utils";

export const CommandRoot: ParentComponent<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div
      class={cn("rounded-md bg-background text-foreground", local.class)}
      cmdk-root=""
      {...others}
    >
      {local.children}
    </div>
  );
};

export const CommandDialog: ParentComponent<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  contentClass?: string;
  children: JSX.Element;
}> = (props) => {
  const [local] = splitProps(props, [
    "open",
    "onOpenChange",
    "children",
    "contentClass",
  ]);
  const presence = createPresence(() => (local.open ? true : undefined), {
    transitionDuration: 220,
    initialEnter: true,
  });

  return (
    <Show when={presence.isMounted()}>
      <DialogPrimitive.Root
        forceMount={true}
        modal
        onOpenChange={local.onOpenChange}
        open={local.open}
      >
        <DialogPrimitive.Portal>
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <DialogPrimitive.Overlay
              class={cn("command-dialog-overlay-motion fixed inset-0")}
              data-component="command-dialog-overlay"
              data-exiting={presence.isExiting() ? "" : undefined}
              data-visible={presence.isVisible() ? "" : undefined}
            />
            <DialogPrimitive.Content
              class={cn(
                "command-dialog-content-motion fixed top-1/2 left-1/2 w-[680px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
                local.contentClass
              )}
              data-component="command-dialog-content"
              data-exiting={presence.isExiting() ? "" : undefined}
              data-visible={presence.isVisible() ? "" : undefined}
            >
              <CommandRoot class="flex size-full flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg blur-none">
                {local.children}
              </CommandRoot>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Show>
  );
};

export const CommandInput: Component<
  Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onInput"> & {
    onValueChange?: (value: string) => void;
  }
> = (props) => {
  const [local, others] = splitProps(props, ["class", "onValueChange"]);
  return (
    <div class="flex items-center border-b px-3" cmdk-input-wrapper="">
      <FiSearch class="mr-2 size-4 shrink-0 opacity-50" />
      <input
        aria-expanded="true"
        autocomplete="off"
        class={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          local.class
        )}
        cmdk-input=""
        onInput={(event) => local.onValueChange?.(event.currentTarget.value)}
        role="combobox"
        {...others}
      />
    </div>
  );
};

export const CommandList: ParentComponent<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div
      class={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", local.class)}
      cmdk-list=""
      role="listbox"
      {...others}
    >
      {local.children}
    </div>
  );
};

export const CommandGroup: ParentComponent<
  { heading?: string } & ComponentProps<"div">
> = (props) => {
  const [local, others] = splitProps(props, ["class", "children", "heading"]);
  return (
    <div
      class={cn("overflow-hidden p-1 text-foreground", local.class)}
      {...others}
    >
      {local.heading ? (
        <p
          class="px-2 py-1.5 font-medium text-muted-foreground text-xs"
          cmdk-group-heading=""
        >
          {local.heading}
        </p>
      ) : null}
      {local.children}
    </div>
  );
};

export const CommandItem: ParentComponent<
  {
    value: string;
    onPick?: (value: string) => void;
  } & ComponentProps<"button">
> = (props) => {
  const [local, others] = splitProps(props, [
    "class",
    "children",
    "value",
    "onPick",
  ]);
  return (
    <button
      class={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        local.class
      )}
      cmdk-item=""
      onClick={() => local.onPick?.(local.value)}
      role="option"
      type="button"
      {...others}
    >
      {local.children}
    </button>
  );
};

export const CommandEmpty: ParentComponent<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <div
      class={cn(
        "px-2 py-3 text-center text-muted-foreground text-xs",
        local.class
      )}
      {...others}
    >
      {local.children}
    </div>
  );
};

export const CommandSeparator: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("h-px bg-border", local.class)} {...others} />;
};
