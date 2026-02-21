import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SwitchPrimitive from "@kobalte/core/switch";

import { cn } from "@/utils";

// Switch Root
type SwitchProps<T extends ValidComponent = "button"> = SwitchPrimitive.SwitchRootProps<T> & {
  class?: string | undefined;
};

const Switch = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SwitchProps<T>>
) => {
  const [local, rest] = splitProps(props as SwitchProps, ["class"]);

  return (
    <SwitchPrimitive.Root
      class={cn(
        "bg-muted focus-visible:ring-ring focus-visible:ring-offset-background data-[checked]:bg-primary data-[unchecked]:bg-input peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        local.class
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb
        class={cn(
          "bg-foreground pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-transform data-[checked]:translate-x-5 data-[unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
};

export { Switch };
