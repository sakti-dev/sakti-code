import { createSignal, Show } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";

interface CloneDialogProps {
  isOpen: boolean;
  onClone: (url: string) => Promise<void>;
  onClose: () => void;
}

export function CloneDialog(props: CloneDialogProps) {
  const [url, setUrl] = createSignal("");
  const [isCloning, setIsCloning] = createSignal(false);
  const [error, setError] = createSignal("");

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");

    if (!url().trim()) {
      setError("Repository URL is required");
      return;
    }

    setIsCloning(true);
    try {
      await props.onClone(url());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone repository");
    } finally {
      setIsCloning(false);
    }
  };

  const handleClose = () => {
    setUrl("");
    setError("");
    props.onClose();
  };

  return (
    <Dialog modal onOpenChange={(open: boolean) => !open && handleClose()} open={props.isOpen}>
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>Clone Repository</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 p-6">
          <TextField>
            <TextFieldLabel>Repository URL</TextFieldLabel>
            <TextFieldInput
              disabled={isCloning()}
              id="clone-repository-url"
              onInput={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://github.com/username/repo"
              type="text"
              value={url()}
            />
          </TextField>

          <Show when={error()}>
            <div class="rounded-md border border-error/20 bg-error/10 p-3">
              <p class="text-error text-sm">{error()}</p>
            </div>
          </Show>
        </div>

        <DialogFooter class="px-6 py-3">
          <button
            class="rounded-md bg-secondary px-4 py-2 font-medium text-secondary-foreground text-sm hover:bg-secondary/80"
            onClick={handleClose}
            type="button"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!url().trim() || isCloning()}
            onClick={handleSubmit}
            type="button"
          >
            {isCloning() ? "Cloning..." : "Clone"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
