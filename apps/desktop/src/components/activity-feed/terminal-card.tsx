/**
 * TerminalCard Component
 *
 * Displays terminal command output in a dark terminal-like card.
 */

import { Show, type Component } from "solid-js";
import type { TerminalData } from "../../types/ui-message";

export interface TerminalCardProps {
  data: TerminalData;
  onFocus?: () => void;
}

export const TerminalCard: Component<TerminalCardProps> = props => {
  const handleFocus = () => {
    if (props.onFocus) {
      props.onFocus();
    } else {
      window.electron?.ipcRenderer?.send("focus-terminal", { id: props.data.id });
    }
  };

  return (
    <div class="ag-terminal-card">
      <div class="ag-terminal-header">
        <div class="ag-terminal-title">
          <span class="opacity-50">$</span> {props.data.command}
        </div>
        <Show when={props.data.exitCode !== undefined}>
          <span
            class={`font-mono text-xs ${
              props.data.exitCode === 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            exit {props.data.exitCode}
          </span>
        </Show>
      </div>

      <div class="ag-terminal-output">{props.data.output || "(no output)"}</div>

      <Show when={props.data.background}>
        <button
          class="text-muted-foreground hover:text-foreground w-full border-t border-white/5 py-1.5 text-center text-xs transition-colors"
          onClick={handleFocus}
        >
          Focus Terminal →
        </button>
      </Show>
    </div>
  );
};

export default TerminalCard;
