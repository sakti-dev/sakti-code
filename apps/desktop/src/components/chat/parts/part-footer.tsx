import dayjs from "dayjs";
import { TbOutlineCheck, TbOutlineCopy } from "solid-icons/tb";
import { type Component, createSignal, onCleanup, Show } from "solid-js";
import { cn } from "~/lib/utils";

export interface PartFooterProps {
  class?: string;
  copyText?: string;
  timestamp: number;
}

export const PartFooter: Component<PartFooterProps> = (props) => {
  const formatted = () => dayjs(props.timestamp).format("DD/MM/YYYY HH:mm");

  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });

  const handleCopy = () => {
    const text = props.copyText;
    if (!text) {
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // ignore clipboard errors
      });
  };

  return (
    <div
      class={cn(
        "flex items-center gap-1.5 text-muted-foreground/50 text-xs",
        props.class
      )}
    >
      <Show when={props.copyText}>
        <button
          class="cursor-pointer transition-colors hover:text-muted-foreground"
          data-slot="part-footer-copy"
          onClick={handleCopy}
          type="button"
        >
          <Show fallback={<TbOutlineCopy class="h-3 w-3" />} when={copied()}>
            <TbOutlineCheck class="h-3 w-3" />
          </Show>
        </button>
      </Show>
      <span>{formatted()}</span>
    </div>
  );
};
