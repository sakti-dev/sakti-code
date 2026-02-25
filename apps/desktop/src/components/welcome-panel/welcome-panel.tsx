import { cn } from "@/utils";
import { For, Show, type Component } from "solid-js";

export interface WelcomeKeypoint {
  id: string;
  taskTitle: string;
  milestone: "started" | "completed";
  completedAt: string;
  summary: string;
}

export interface WelcomePanelProps {
  title?: string;
  subtitle?: string;
  keypoints?: WelcomeKeypoint[];
  class?: string;
}

function formatRelativeTime(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

export const WelcomePanel: Component<WelcomePanelProps> = props => {
  const heading = () => props.title ?? "Welcome back";
  const subheading =
    () => props.subtitle ?? "Start a new task from the homepage or continue a recent one.";
  const keypoints = () => props.keypoints ?? [];

  return (
    <section class={cn("rounded-2xl border border-border/40 bg-card/20 p-5", props.class)}>
      <h1 class="text-foreground text-xl font-semibold">{heading()}</h1>
      <p class="text-muted-foreground mt-1 text-sm">{subheading()}</p>

      <Show when={keypoints().length > 0}>
        <div class="mt-4 border-t border-border/30 pt-4" data-section="progress">
          <p class="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
            Recent progress
          </p>

          <div class="flex flex-col gap-2">
            <For each={keypoints()}>
              {keypoint => (
                <article class="rounded-lg border border-border/30 bg-background/60 p-3">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-foreground text-sm font-medium">{keypoint.taskTitle}</p>
                    <span class="text-muted-foreground text-xs">
                      {formatRelativeTime(keypoint.completedAt)}
                    </span>
                  </div>
                  <p class="text-muted-foreground mt-1 text-sm">{keypoint.summary}</p>
                </article>
              )}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
};

export default WelcomePanel;
