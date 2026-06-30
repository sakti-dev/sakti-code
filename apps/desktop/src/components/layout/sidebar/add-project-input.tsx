import { createSignal, type ParentComponent } from "solid-js";

import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { cn } from "~/lib/utils";

export interface AddProjectInputProps {
  onAdd: (cwd: string) => void;
  onCancel: () => void;
}

export const AddProjectInput: ParentComponent<AddProjectInputProps> = (props) => {
  const [value, setValue] = createSignal("");

  const handleSubmit = () => {
    const trimmed = value().trim();
    if (trimmed) {
      props.onAdd(trimmed);
    }
  };

  return (
    <div class="flex flex-col gap-1 px-3 py-2">
      <label class="text-[10px] text-muted-foreground" for="add-project-path">
        Enter folder path
      </label>
      <div class="flex items-center gap-1">
        <TextField class="contents">
          <TextFieldInput
            class="min-w-0 flex-1"
            id="add-project-path"
            onInput={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                props.onCancel();
              }
            }}
            placeholder="/path/to/project"
            type="text"
            value={value()}
          />
        </TextField>
        <button
          class={cn(
            "rounded px-2 py-1 font-medium text-xs transition-colors",
            value().trim()
              ? "bg-primary text-primary-foreground hover:bg-primary/80"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
          disabled={!value().trim()}
          onClick={handleSubmit}
          type="button"
        >
          Add
        </button>
        <button
          class="rounded px-1.5 py-1 text-muted-foreground text-xs hover:text-foreground"
          onClick={props.onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
