import { FiSearch, FiX } from "solid-icons/fi";
import type { JSX } from "solid-js";
import { Show } from "solid-js";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group";
import { cn } from "~/lib/utils";

interface SearchBarProps {
  readonly class?: string;
  readonly inputProps?: Omit<
    JSX.InputHTMLAttributes<HTMLInputElement>,
    "autocomplete" | "onInput" | "placeholder" | "type" | "value"
  >;
  readonly mode?: "compact" | "full";
  readonly onInput: (value: string) => void;
  readonly placeholder?: string;
  readonly trailing?: JSX.Element;
  readonly value: string;
}

export const SearchBar = (props: SearchBarProps) => {
  const startPadding = () => (props.mode === "compact" ? "pl-2" : "pl-4");
  const endWidth = () => (props.mode === "compact" ? "w-9" : "w-10");

  return (
    <InputGroup class={cn("rounded-xl shadow-sm", props.class)}>
      <InputGroupAddon class={startPadding()}>
        <FiSearch class="size-4" />
      </InputGroupAddon>
      <InputGroupInput
        {...props.inputProps}
        autocomplete="off"
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && props.value) {
            e.preventDefault();
            props.onInput("");
          }
        }}
        placeholder={props.placeholder ?? "Search..."}
        type="text"
        value={props.value}
      />
      <Show when={props.value.length > 0}>
        <InputGroupAddon align="inline-end" class={endWidth()} separator>
          <InputGroupButton
            aria-label="Clear"
            class="text-muted-foreground hover:text-destructive"
            onClick={() => props.onInput("")}
            size="icon-xs"
            variant="ghost"
          >
            <FiX />
          </InputGroupButton>
        </InputGroupAddon>
      </Show>
      {props.trailing}
    </InputGroup>
  );
};
