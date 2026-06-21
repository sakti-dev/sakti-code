import { Dialog as DialogPrimitive } from "@kobalte/core/dialog";
import { type JSX, type ParentComponent, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

const Dialog = DialogPrimitive;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.CloseButton;

const DialogOverlay: ParentComponent<{ class?: string }> = (props) => (
  <DialogPrimitive.Overlay
    class={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[expanded]:fade-in-0 data-[expanded]:animate-in",
      "data-[closed]:fade-out-0 data-[closed]:animate-out",
      props.class
    )}
  />
);

const DialogContent: ParentComponent<
  JSX.IntrinsicElements["div"] & { class?: string }
> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        class={cn(
          "fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "border bg-card p-6 text-card-foreground shadow-2xl",
          "rounded-xl",
          "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95 data-[expanded]:slide-in-from-left-1/2 data-[expanded]:slide-in-from-top-[48%] data-[expanded]:animate-in",
          "data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[closed]:slide-out-to-left-1/2 data-[closed]:slide-out-to-top-[48%] data-[closed]:animate-out",
          local.class
        )}
        {...others}
      >
        {local.children}
        <DialogPrimitive.CloseButton class="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <svg
            aria-label="Close"
            class="h-4 w-4"
            fill="none"
            role="img"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Close</title>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          <span class="sr-only">Close</span>
        </DialogPrimitive.CloseButton>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

const DialogTitle: ParentComponent<
  JSX.IntrinsicElements["h2"] & { class?: string }
> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Title
      class={cn(
        "font-semibold text-foreground text-lg leading-none tracking-tight",
        local.class
      )}
      {...others}
    />
  );
};

const DialogDescription: ParentComponent<
  JSX.IntrinsicElements["p"] & { class?: string }
> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Description
      class={cn("text-muted-foreground text-sm", local.class)}
      {...others}
    />
  );
};

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
