import { BigChatInput } from "@/components/big-chat-input/big-chat-input";
import { ResearchOutput } from "@/components/research-output/research-output";
import { TaskList } from "@/components/task-list/task-list";
import type { TaskCardData } from "@/components/task-card/task-card";
import { TopToolbar } from "@/components/top-toolbar/top-toolbar";
import { WelcomePanel, type WelcomeKeypoint } from "@/components/welcome-panel/welcome-panel";
import { cn } from "@/utils";
import Resizable from "@corvu/resizable";
import { type Component } from "solid-js";

export interface HomepageViewProps {
  tasks: TaskCardData[];
  activeTaskSessionId?: string | null;
  keypoints?: WelcomeKeypoint[];
  researchSummary?: string;
  researchLoading?: boolean;
  researchError?: string | null;
  isApplyingResearchAction?: boolean;
  onTaskSelect?: (taskSessionId: string) => void;
  onSubmitResearch?: (message: string) => void;
  onResearchAction?: (action: string) => void;
  class?: string;
}

export const HomepageView: Component<HomepageViewProps> = props => {
  return (
    <Resizable class={cn("flex h-full w-full overflow-hidden", props.class)} sizes={[0.3, 0.7]}>
      <Resizable.Panel minSize={0.2} initialSize={0.3} class="border-border/30 border-r p-3">
        <TaskList
          tasks={props.tasks}
          activeTaskSessionId={props.activeTaskSessionId}
          onTaskSelect={props.onTaskSelect}
        />
      </Resizable.Panel>

      <Resizable.Panel minSize={0.4} initialSize={0.7} class="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <TopToolbar view="homepage" />

        <WelcomePanel keypoints={props.keypoints} />

        <ResearchOutput
          loading={props.researchLoading || props.isApplyingResearchAction}
          summary={props.researchSummary}
          buttons={
            props.researchSummary
              ? [
                  {
                    id: "choose-comprehensive",
                    label: "Comprehensive",
                    action: "wizard:start:comprehensive",
                    variant: "primary",
                  },
                  {
                    id: "choose-quick",
                    label: "Quick",
                    action: "wizard:start:quick",
                    variant: "secondary",
                  },
                ]
              : []
          }
          onAction={action => props.onResearchAction?.(action)}
        />
        {props.researchError ? (
          <p class="text-sm text-red-600" role="alert">
            {props.researchError}
          </p>
        ) : null}

        <div class="mt-auto">
          <BigChatInput onSubmit={message => props.onSubmitResearch?.(message)} />
        </div>
      </Resizable.Panel>
    </Resizable>
  );
};

export default HomepageView;
