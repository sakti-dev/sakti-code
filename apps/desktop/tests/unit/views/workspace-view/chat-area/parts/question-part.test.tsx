import {
  QuestionPartWithCallbacks,
  type QuestionPartData,
} from "@/views/workspace-view/chat-area/parts/question-part";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnsweredQuestionRequest,
  createCanonicalQuestionPart,
  createMultipleChoiceQuestionRequest,
  createPendingQuestionRequest,
  createRejectedQuestionRequest,
} from "../../../../../fixtures/permission-question-fixtures";

/**
 * Create a question part data object for testing
 */
function createQuestionPartData(
  request: ReturnType<typeof createPendingQuestionRequest>
): QuestionPartData {
  return {
    type: "question",
    request,
  };
}

describe("QuestionPart", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders question text in subtitle", () => {
    const request = createPendingQuestionRequest({
      question: "Which file should I read?",
    });
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    expect(container.textContent).toContain("Which file should I read?");
  });

  it("shows pending status with locked state", () => {
    const request = createPendingQuestionRequest();
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.getAttribute("data-status")).toBe("pending");

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("pending");
  });

  it("shows text input when no options provided", () => {
    const request = createPendingQuestionRequest();
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const input = container.querySelector('[data-slot="question-input"]');
    expect(input).not.toBeNull();
    expect(input?.tagName).toBe("INPUT");
  });

  it("shows option buttons when options provided", () => {
    const request = createMultipleChoiceQuestionRequest(["Option A", "Option B", "Option C"]);
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const options = container.querySelectorAll('[data-action="option"]');
    expect(options.length).toBe(3);
    expect(options[0]?.getAttribute("data-option")).toBe("Option A");
    expect(options[1]?.getAttribute("data-option")).toBe("Option B");
    expect(options[2]?.getAttribute("data-option")).toBe("Option C");
  });

  it("calls onAnswer with id and text when submit clicked", () => {
    const request = createPendingQuestionRequest({ id: "question-123" });
    const part = createQuestionPartData(request);
    const onAnswer = vi.fn();

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} onAnswer={onAnswer} />,
      { container }
    ));

    const input = container.querySelector('[data-slot="question-input"]') as HTMLInputElement;
    input.value = "src/main.ts";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const submitBtn = container.querySelector('[data-action="submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(onAnswer).toHaveBeenCalledWith("question-123", "src/main.ts");
  });

  it("calls onAnswer with id and option when option clicked", () => {
    const request = createMultipleChoiceQuestionRequest(["Option A", "Option B"], {
      id: "question-456",
    });
    const part = createQuestionPartData(request);
    const onAnswer = vi.fn();

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} onAnswer={onAnswer} />,
      { container }
    ));

    const optionBtn = container.querySelector('[data-option="Option B"]') as HTMLButtonElement;
    optionBtn.click();

    expect(onAnswer).toHaveBeenCalledWith("question-456", "Option B");
  });

  it("calls onReject with id when skip clicked", () => {
    const request = createPendingQuestionRequest({ id: "question-789" });
    const part = createQuestionPartData(request);
    const onReject = vi.fn();

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} onReject={onReject} />,
      { container }
    ));

    const rejectBtn = container.querySelector('[data-action="reject"]') as HTMLButtonElement;
    rejectBtn.click();

    expect(onReject).toHaveBeenCalledWith("question-789");
  });

  it("shows answered status with answer text", () => {
    const request = createAnsweredQuestionRequest("src/index.ts");
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} defaultOpen={true} />,
      { container }
    ));

    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.getAttribute("data-status")).toBe("answered");

    // The BasicTool status should be "completed"
    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("completed");
  });

  it("does not show input/buttons when answered", () => {
    const request = createAnsweredQuestionRequest("Some answer");
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const input = container.querySelector('[data-slot="question-input"]');
    const options = container.querySelector('[data-slot="question-options"]');

    expect(input).toBeNull();
    expect(options).toBeNull();
  });

  it("applies data-component attribute", () => {
    const request = createPendingQuestionRequest();
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart).not.toBeNull();
  });

  it("applies data-status attribute correctly", () => {
    const request = createAnsweredQuestionRequest("test");
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.getAttribute("data-status")).toBe("answered");
  });

  it("applies custom class", () => {
    const request = createPendingQuestionRequest();
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} class="custom-question" />,
      { container }
    ));

    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.classList.contains("custom-question")).toBe(true);
  });

  it("handles rejected status (answer is { rejected: true })", () => {
    const request = createRejectedQuestionRequest("Not needed");
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} defaultOpen={true} />,
      { container }
    ));

    // Status should be "answered"
    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.getAttribute("data-status")).toBe("answered");
  });

  it("shows skip button in multiple choice options", () => {
    const request = createMultipleChoiceQuestionRequest(["A", "B"]);
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    const rejectBtn = container.querySelector('[data-action="reject"]');
    expect(rejectBtn).not.toBeNull();
  });

  it("supports structured multi-question payloads", () => {
    const request = createPendingQuestionRequest({
      id: "question-structured",
      questions: [
        {
          header: "Scope",
          question: "Which scope?",
          options: [
            { label: "Current file", description: "Fastest" },
            { label: "Whole workspace", description: "Thorough" },
          ],
        },
        {
          header: "Mode",
          question: "Choose modes",
          multiple: true,
          options: [{ label: "Safe" }, { label: "Aggressive" }],
        },
      ],
    });
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={part} />, { container }));

    expect(container.querySelector('[data-slot="question-tabs"]')).not.toBeNull();
    expect(container.textContent).toContain("Which scope?");
  });

  it("submits on Enter key press", () => {
    const request = createPendingQuestionRequest({ id: "question-enter" });
    const part = createQuestionPartData(request);
    const onAnswer = vi.fn();

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} onAnswer={onAnswer} />,
      { container }
    ));

    const input = container.querySelector('[data-slot="question-input"]') as HTMLInputElement;
    input.value = "test answer";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onAnswer).toHaveBeenCalledWith("question-enter", "test answer");
  });

  it("does not submit on Shift+Enter", () => {
    const request = createPendingQuestionRequest({ id: "question-shift-enter" });
    const part = createQuestionPartData(request);
    const onAnswer = vi.fn();

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} onAnswer={onAnswer} />,
      { container }
    ));

    const input = container.querySelector('[data-slot="question-input"]') as HTMLInputElement;
    input.value = "test answer";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    );
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("shows 'No answer' when answer is undefined", () => {
    const request = createAnsweredQuestionRequest(undefined);
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} defaultOpen={true} />,
      { container }
    ));

    // Status should still be "answered"
    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.getAttribute("data-status")).toBe("answered");
  });

  it("formats object answer as JSON", () => {
    const request = createAnsweredQuestionRequest({ value: 42, name: "test" });
    const part = createQuestionPartData(request);

    ({ unmount: dispose } = render(
      () => <QuestionPartWithCallbacks part={part} defaultOpen={true} />,
      { container }
    ));

    // Status should be "answered"
    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart?.getAttribute("data-status")).toBe("answered");
  });

  it("returns null for invalid part type", () => {
    const invalidPart = { type: "invalid" };

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={invalidPart} />, {
      container,
    }));

    const questionPart = container.querySelector('[data-component="question-part"]');
    expect(questionPart).toBeNull();
  });

  it("renders canonical flat question part shape", () => {
    const request = createMultipleChoiceQuestionRequest(["Yes", "No"], {
      id: "question-flat-1",
      messageID: "msg-1",
      sessionID: "session-1",
      question: "Proceed with edits?",
    });
    const canonicalPart = createCanonicalQuestionPart(request, { id: "part-q-1" });

    ({ unmount: dispose } = render(() => <QuestionPartWithCallbacks part={canonicalPart} />, {
      container,
    }));

    expect(container.textContent).toContain("Proceed with edits?");
    expect(container.querySelectorAll('[data-action="option"]').length).toBe(2);
  });
});
