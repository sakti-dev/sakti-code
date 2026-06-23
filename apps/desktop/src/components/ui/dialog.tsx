import * as DialogPrimitive from "@kobalte/core/dialog";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { FiX } from "solid-icons/fi";
import type { Component, ComponentProps, JSX, ValidComponent } from "solid-js";
import { createUniqueId, onCleanup, splitProps } from "solid-js";
import "./dialog.css";

import { useDismissibleVisibility } from "~/lib/ui/dismissible-stack";
import { cn } from "~/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal: Component<DialogPrimitive.DialogPortalProps> = (props) => {
  const [, rest] = splitProps(props, ["children"]);
  return (
    <DialogPrimitive.Portal {...rest}>
      <div class="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
        {props.children}
      </div>
    </DialogPrimitive.Portal>
  );
};

type DialogOverlayProps<T extends ValidComponent = "div"> =
  DialogPrimitive.DialogOverlayProps<T> & { class?: string | undefined };

const DialogOverlay = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DialogOverlayProps<T>>
) => {
  const [, rest] = splitProps(props as DialogOverlayProps, ["class"]);
  return (
    <DialogPrimitive.Overlay
      class={cn(
        "data-[closed]:fade-out-0 data-[expanded]:fade-in-0 fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[closed]:animate-out data-[expanded]:animate-in",
        props.class
      )}
      {...rest}
    />
  );
};

type DialogContentProps<T extends ValidComponent = "div"> =
  DialogPrimitive.DialogContentProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

const DialogContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DialogContentProps<T>>
) => {
  const [local, rest] = splitProps(props as DialogContentProps, [
    "class",
    "children",
    "ref",
  ]);
  const stackId = createUniqueId();
  const { isTopmost, show, hide } = useDismissibleVisibility(stackId);
  return (
    <DialogPortal>
      <DialogOverlay
        class={cn(!isTopmost() && "pointer-events-none opacity-0")}
        data-stack-overlay={stackId}
      />
      <DialogPrimitive.Content
        class={cn(
          "model-selector-shell data-[closed]:fade-out-0 data-[expanded]:fade-in-0 relative z-50 w-full max-w-4xl overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-[0_28px_80px_rgba(0,0,0,0.6)] duration-200 data-[closed]:animate-out data-[expanded]:animate-in",
          !isTopmost() && "pointer-events-none opacity-0",
          local.class
        )}
        data-stack-content={stackId}
        ref={(el: HTMLDivElement) => {
          // Ref runs inside Kobalte's <Show when={contentPresent()}>,
          // so show()/hide() sync with the dialog's actual visibility.
          show();
          onCleanup(hide);
          if (typeof local.ref === "function") {
            local.ref(el);
          }
        }}
        {...rest}
      >
        <div class="model-selector-aurora pointer-events-none">
          <div class="model-selector-aurora-glow" />
          <div class="model-selector-aurora-vignette" />
        </div>
        <div class="model-selector-grain pointer-events-none absolute inset-0" />
        {props.children}
        <DialogPrimitive.CloseButton class="absolute top-4 right-4 z-20 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[expanded]:bg-accent data-[expanded]:text-muted-foreground">
          <FiX class="size-4" />
          <span class="sr-only">Close</span>
        </DialogPrimitive.CloseButton>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

const DialogHeader: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "relative border-border/80 border-b bg-muted/45 px-4 pt-4 pb-2.5 backdrop-blur-xl",
        props.class
      )}
      {...rest}
    />
  );
};

const DialogFooter: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex items-center justify-end gap-2 border-border/80 border-t bg-muted/55 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur-xl",
        props.class
      )}
      {...rest}
    />
  );
};

type DialogTitleProps<T extends ValidComponent = "h2"> =
  DialogPrimitive.DialogTitleProps<T> & {
    class?: string | undefined;
  };

const DialogTitle = <T extends ValidComponent = "h2">(
  props: PolymorphicProps<T, DialogTitleProps<T>>
) => {
  const [, rest] = splitProps(props as DialogTitleProps, ["class"]);
  return (
    <DialogPrimitive.Title
      class={cn(
        "font-semibold text-[13px] text-popover-foreground tracking-tight",
        props.class
      )}
      {...rest}
    />
  );
};

type DialogDescriptionProps<T extends ValidComponent = "p"> =
  DialogPrimitive.DialogDescriptionProps<T> & {
    class?: string | undefined;
  };

const DialogDescription = <T extends ValidComponent = "p">(
  props: PolymorphicProps<T, DialogDescriptionProps<T>>
) => {
  const [, rest] = splitProps(props as DialogDescriptionProps, ["class"]);
  return (
    <DialogPrimitive.Description
      class={cn("text-[10px] text-muted-foreground", props.class)}
      {...rest}
    />
  );
};

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
