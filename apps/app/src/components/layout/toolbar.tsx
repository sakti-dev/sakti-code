import GitStatusBar from "../toolbar/git-status-bar";
import ModelSelector from "../toolbar/model-selector";
import SessionStats from "../toolbar/session-stats";
import ThinkingSelector from "../toolbar/thinking-selector";

export default function Toolbar() {
  return (
    <div class="flex h-10 shrink-0 items-center justify-between border-border border-b px-4">
      <div class="flex items-center gap-4">
        <GitStatusBar />
        <SessionStats />
      </div>
      <div class="flex items-center gap-2">
        <ModelSelector />
        <ThinkingSelector />
      </div>
    </div>
  );
}
