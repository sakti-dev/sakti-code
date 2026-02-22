/**
 * QuestionPart Component
 *
 * Renders question requests inline in the message timeline.
 * Supports both legacy single-question payloads and structured multi-question payloads.
 */

import type {
  QuestionOption,
  QuestionPrompt,
  QuestionRequest,
} from "@/core/state/stores/question-store";
import { cn } from "@/utils";
import type { PartProps } from "@/views/workspace-view/chat-area/parts/part-registry";
import { BasicTool } from "@/views/workspace-view/chat-area/tools/basic-tool";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";

/**
 * Question part data structure
 */
export interface QuestionPartData {
  [key: string]: unknown;
  type: "question";
  request: QuestionRequest;
}

/**
 * Check if answer is a rejection
 */
function isRejectedAnswer(answer: unknown): boolean {
  return (
    typeof answer === "object" &&
    answer !== null &&
    "rejected" in answer &&
    (answer as { rejected: boolean }).rejected === true
  );
}

/**
 * Format answer for display
 */
function formatAnswer(answer: unknown): string {
  if (answer === undefined || answer === null) return "No answer";
  if (isRejectedAnswer(answer)) {
    const reason = (answer as { reason?: string }).reason;
    return reason ? `Skipped: ${reason}` : "Skipped";
  }
  if (typeof answer === "string") return answer;
  return JSON.stringify(answer);
}

function toQuestionOptions(value: unknown): QuestionOption[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const options = value
    .map(option => {
      if (typeof option === "string") {
        return { label: option };
      }
      if (
        typeof option === "object" &&
        option !== null &&
        typeof (option as { label?: unknown }).label === "string"
      ) {
        const typed = option as { label: string; description?: unknown };
        return {
          label: typed.label,
          description: typeof typed.description === "string" ? typed.description : undefined,
        };
      }
      return undefined;
    })
    .filter((option): option is QuestionOption => Boolean(option));

  return options.length > 0 ? options : undefined;
}

/**
 * Extract question request from part data
 */
function getQuestionRequest(part: Record<string, unknown>): QuestionRequest | null {
  if (part.type !== "question") return null;
  if (part.request && typeof part.request === "object") {
    return part.request as QuestionRequest;
  }

  const id =
    typeof part.questionId === "string"
      ? part.questionId
      : typeof part.id === "string"
        ? part.id
        : undefined;
  const question = typeof part.question === "string" ? part.question : undefined;
  if (!id || !question) return null;

  const rawStatus =
    typeof part.status === "string"
      ? part.status
      : typeof (part.state as { status?: unknown } | undefined)?.status === "string"
        ? (part.state as { status: string }).status
        : "pending";

  const structuredQuestions =
    Array.isArray(part.questions) && part.questions.length > 0
      ? part.questions
          .map(item => {
            if (typeof item !== "object" || item === null) return undefined;
            const typed = item as {
              header?: unknown;
              question?: unknown;
              options?: unknown;
              multiple?: unknown;
            };
            if (typeof typed.question !== "string") return undefined;
            return {
              header: typeof typed.header === "string" ? typed.header : undefined,
              question: typed.question,
              options: toQuestionOptions(typed.options),
              multiple: typed.multiple === true,
            } as QuestionPrompt;
          })
          .filter((item): item is QuestionPrompt => Boolean(item))
      : undefined;

  return {
    id,
    sessionID: typeof part.sessionID === "string" ? part.sessionID : "",
    messageID: typeof part.messageID === "string" ? part.messageID : "",
    questions:
      structuredQuestions && structuredQuestions.length > 0
        ? structuredQuestions
        : [
            {
              question,
              options: toQuestionOptions(part.options),
            },
          ],
    question,
    options: Array.isArray(part.options)
      ? part.options.filter((option): option is string => typeof option === "string")
      : undefined,
    status: rawStatus === "answered" ? "answered" : "pending",
    answer: part.answer,
    timestamp: typeof part.timestamp === "number" ? part.timestamp : Date.now(),
    callID: typeof part.callID === "string" ? part.callID : undefined,
  };
}

function promptSubtitle(request: QuestionRequest): string {
  const count = request.questions.length;
  if (count <= 1) return request.questions[0]?.question ?? request.question;
  return `${count} questions`;
}

export const QuestionPart: Component<PartProps> = props => {
  const classes = () => (props as PartProps & { class?: string }).class;
  const request = () => getQuestionRequest(props.part);
  const status = () => request()?.status ?? "pending";
  const isPending = () => status() === "pending";

  const [tab, setTab] = createSignal(0);
  const [textInput, setTextInput] = createSignal("");
  const [answers, setAnswers] = createSignal<Record<number, string[]>>({});
  const [customMode, setCustomMode] = createSignal(false);

  // If no valid request, render nothing
  if (!request()) {
    return null;
  }

  const prompts = createMemo(() => request()?.questions ?? []);
  const singlePrompt = createMemo(() => prompts().length <= 1);
  const activePrompt = createMemo(() => prompts()[tab()] ?? prompts()[0]);
  const isConfirmStep = createMemo(() => !singlePrompt() && tab() >= prompts().length);

  const activeOptions = createMemo(() => activePrompt()?.options ?? []);
  const hasOptions = createMemo(() => activeOptions().length > 0);
  const isMultiple = createMemo(() => activePrompt()?.multiple === true);

  const setAnswer = (index: number, next: string[]) => {
    setAnswers(prev => ({ ...prev, [index]: next }));
  };

  const pickSingle = (value: string) => {
    const currentTab = tab();
    setAnswer(currentTab, [value]);
    setCustomMode(false);

    if (singlePrompt()) {
      const id = request()?.id;
      if (!id) return;
      void props.onQuestionAnswer?.(id, value);
      return;
    }

    setTab(currentTab + 1);
    setTextInput("");
  };

  const toggleMultiple = (value: string) => {
    const currentTab = tab();
    const current = answers()[currentTab] ?? [];
    if (current.includes(value)) {
      setAnswer(
        currentTab,
        current.filter(item => item !== value)
      );
      return;
    }
    setAnswer(currentTab, [...current, value]);
  };

  const handleSubmitText = () => {
    const value = textInput().trim();
    if (!value) return;

    if (isMultiple()) {
      const currentTab = tab();
      const current = answers()[currentTab] ?? [];
      if (!current.includes(value)) {
        setAnswer(currentTab, [...current, value]);
      }
      setTextInput("");
      setCustomMode(false);
      return;
    }

    pickSingle(value);
  };

  const handleOptionClick = (option: QuestionOption) => {
    setCustomMode(false);
    if (isMultiple()) {
      toggleMultiple(option.label);
      return;
    }
    pickSingle(option.label);
  };

  const handleReject = () => {
    const id = request()?.id;
    if (!id) return;
    void props.onQuestionReject?.(id);
  };

  const handleSubmitAll = () => {
    const id = request()?.id;
    if (!id) return;

    const payload = prompts().map((_, index) => answers()[index] ?? []);
    void props.onQuestionAnswer?.(id, payload);
  };

  const handleNext = () => {
    if (singlePrompt()) return;
    setTab(prev => prev + 1);
    setTextInput("");
    setCustomMode(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitText();
    }
  };

  return (
    <div
      data-component="question-part"
      data-status={status()}
      class={cn("question-part", classes())}
    >
      <BasicTool
        trigger={{
          title: "Question",
          subtitle: promptSubtitle(request()!),
        }}
        icon="help"
        status={isPending() ? "pending" : "completed"}
        locked={isPending()}
        forceOpen={isPending()}
      >
        <Show when={isPending()}>
          <Show when={!singlePrompt()}>
            <div data-slot="question-tabs" class="mb-2 flex gap-1">
              <For each={prompts()}>
                {(prompt, index) => (
                  <button
                    data-slot="question-tab"
                    data-active={index() === tab()}
                    class={cn(
                      "rounded border px-2 py-1 text-xs",
                      index() === tab() ? "bg-primary text-primary-foreground" : "bg-background"
                    )}
                    onClick={() => {
                      setTab(index());
                      setCustomMode(false);
                      setTextInput("");
                    }}
                  >
                    {prompt.header ?? `Q${index() + 1}`}
                  </button>
                )}
              </For>
              <button
                data-slot="question-tab"
                data-active={isConfirmStep()}
                class={cn(
                  "rounded border px-2 py-1 text-xs",
                  isConfirmStep() ? "bg-primary text-primary-foreground" : "bg-background"
                )}
                onClick={() => {
                  setTab(prompts().length);
                  setCustomMode(false);
                }}
              >
                Confirm
              </button>
            </div>
          </Show>

          <Show
            when={!isConfirmStep()}
            fallback={
              <div data-slot="question-review" class="space-y-2">
                <For each={prompts()}>
                  {(prompt, index) => {
                    const value = () => (answers()[index()] ?? []).join(", ");
                    return (
                      <div data-slot="review-item" class="text-sm">
                        <div class="text-muted-foreground">{prompt.question}</div>
                        <div>{value() || "Not answered"}</div>
                      </div>
                    );
                  }}
                </For>
              </div>
            }
          >
            <div data-slot="question-content" class="space-y-2">
              <div data-slot="question-text" class="text-sm">
                {activePrompt()?.question}
                <Show when={isMultiple()}>
                  <span class="text-muted-foreground"> (select multiple)</span>
                </Show>
              </div>

              <Show when={hasOptions()}>
                <div data-slot="question-options" class="flex flex-col gap-1">
                  <For each={activeOptions()}>
                    {option => {
                      const selected = () => {
                        const current = answers()[tab()] ?? [];
                        return current.includes(option.label);
                      };

                      return (
                        <button
                          data-action="option"
                          data-option={option.label}
                          data-picked={selected()}
                          class={cn(
                            "rounded border px-3 py-1.5 text-left text-sm",
                            selected() ? "bg-primary/10 border-primary/40" : "bg-background"
                          )}
                          onClick={() => handleOptionClick(option)}
                        >
                          <div>{option.label}</div>
                          <Show when={option.description}>
                            <div class="text-muted-foreground text-xs">{option.description}</div>
                          </Show>
                        </button>
                      );
                    }}
                  </For>

                  <Show when={!isMultiple()}>
                    <button
                      data-action="custom-answer"
                      class={cn(
                        "rounded border px-3 py-1.5 text-left text-sm",
                        customMode() ? "bg-primary/10 border-primary/40" : "bg-background"
                      )}
                      onClick={() => setCustomMode(true)}
                    >
                      Type your own answer
                    </button>
                  </Show>
                </div>
              </Show>

              <Show when={!hasOptions() || isMultiple() || customMode()}>
                <div data-slot="question-input-group" class="flex flex-col gap-2">
                  <input
                    data-slot="question-input"
                    type="text"
                    value={textInput()}
                    onInput={e => setTextInput(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    class="border-input bg-background focus:ring-primary/30 rounded border px-3 py-1 text-sm focus:outline-none focus:ring-2"
                    placeholder="Type your answer..."
                  />
                  <Show when={!hasOptions() || isMultiple() || customMode()}>
                    <button
                      data-action="submit"
                      class="bg-primary text-primary-foreground hover:bg-primary/90 w-fit rounded px-3 py-1 text-sm"
                      onClick={handleSubmitText}
                    >
                      {isMultiple() ? "Add" : "Submit"}
                    </button>
                    <Show when={customMode()}>
                      <button
                        data-action="cancel-custom"
                        class="bg-muted text-muted-foreground hover:bg-muted/80 w-fit rounded px-3 py-1 text-sm"
                        onClick={() => {
                          setCustomMode(false);
                          setTextInput("");
                        }}
                      >
                        Cancel
                      </button>
                    </Show>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          <div data-slot="question-actions" class="mt-3 flex gap-2">
            <button
              data-action="reject"
              class="bg-muted text-muted-foreground hover:bg-muted/80 rounded px-3 py-1 text-sm"
              onClick={handleReject}
            >
              Skip
            </button>

            <Show when={!singlePrompt() && !isConfirmStep()}>
              <button
                data-action="next"
                class="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded px-3 py-1 text-sm"
                onClick={handleNext}
              >
                Next
              </button>
            </Show>

            <Show when={!singlePrompt() && isConfirmStep()}>
              <button
                data-action="submit-all"
                class="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1 text-sm"
                onClick={handleSubmitAll}
              >
                Submit
              </button>
            </Show>
          </div>
        </Show>

        <Show when={!isPending()}>
          <div data-slot="question-answer" class="text-sm">
            <span class="text-muted-foreground">Answer: </span>
            <span>{formatAnswer(request()?.answer)}</span>
          </div>
        </Show>
      </BasicTool>
    </div>
  );
};

/**
 * Extended props for testing with callbacks
 */
export interface QuestionPartTestProps extends PartProps {
  /** Callback when user answers */
  onAnswer?: (id: string, answer: unknown) => void;
  /** Callback when user rejects */
  onReject?: (id: string) => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * QuestionPartWithCallbacks - Version with callbacks for testing
 */
export const QuestionPartWithCallbacks: Component<QuestionPartTestProps> = props => {
  return (
    <QuestionPart
      {...props}
      onQuestionAnswer={(id, answer) => {
        props.onAnswer?.(id, answer);
        return props.onQuestionAnswer?.(id, answer);
      }}
      onQuestionReject={id => {
        props.onReject?.(id);
        return props.onQuestionReject?.(id);
      }}
    />
  );
};
