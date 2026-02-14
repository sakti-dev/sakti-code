/**
 * Question Store Tests
 */

import {
  createEmptyQuestionState,
  createQuestionStore,
  type QuestionRequest,
} from "@/core/state/stores/question-store";
import { describe, expect, it } from "vitest";

describe("Question Store", () => {
  const createSampleQuestion = (overrides?: Partial<QuestionRequest>): QuestionRequest => ({
    id: "q-1",
    sessionID: "session-1",
    messageID: "msg-1",
    question: "What is your name?",
    options: ["Alice", "Bob", "Charlie"],
    status: "pending",
    timestamp: Date.now(),
    ...overrides,
  });

  describe("createEmptyQuestionState", () => {
    it("creates empty state", () => {
      const state = createEmptyQuestionState();
      expect(state.byId).toEqual({});
      expect(state.bySession).toEqual({});
      expect(state.pendingOrder).toEqual([]);
    });
  });

  describe("add", () => {
    it("adds question to byId", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion();

      actions.add(question);

      expect(state.byId["q-1"]).toEqual(
        expect.objectContaining({
          ...question,
          questions: [
            {
              question: question.question,
              options: question.options?.map(label => ({ label })),
            },
          ],
        })
      );
    });

    it("adds question to session grouping", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion();

      actions.add(question);

      expect(state.bySession["session-1"]).toContain("q-1");
    });

    it("adds pending question to pendingOrder", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion({ status: "pending" });

      actions.add(question);

      expect(state.pendingOrder).toContain("q-1");
    });

    it("reconciles session and pending indexes when re-adding existing ID", () => {
      const [state, actions] = createQuestionStore();
      actions.add(createSampleQuestion({ id: "q-1", sessionID: "session-1", status: "pending" }));
      actions.add(createSampleQuestion({ id: "q-1", sessionID: "session-2", status: "answered" }));

      expect(state.bySession["session-1"]).not.toContain("q-1");
      expect(state.bySession["session-2"]).toContain("q-1");
      expect(state.pendingOrder).not.toContain("q-1");
      expect(state.byId["q-1"].status).toBe("answered");
    });
  });

  describe("answer", () => {
    it("answers pending question", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion({ status: "pending" });
      actions.add(question);

      actions.answer("q-1", "Alice");

      expect(state.byId["q-1"].status).toBe("answered");
      expect(state.byId["q-1"].answer).toBe("Alice");
    });

    it("removes answered question from pendingOrder", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion({ status: "pending" });
      actions.add(question);

      actions.answer("q-1", "Alice");

      expect(state.pendingOrder).not.toContain("q-1");
    });

    it("supports non-string answers", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion({ status: "pending" });
      actions.add(question);

      actions.answer("q-1", { selected: "Alice" });

      expect(state.byId["q-1"].answer).toEqual({ selected: "Alice" });
    });
  });

  describe("getBySession", () => {
    it("returns questions for session", () => {
      const [, actions] = createQuestionStore();
      const q1 = createSampleQuestion({ id: "q-1", sessionID: "session-1" });
      const q2 = createSampleQuestion({ id: "q-2", sessionID: "session-1" });
      const q3 = createSampleQuestion({ id: "q-3", sessionID: "session-2" });

      actions.add(q1);
      actions.add(q2);
      actions.add(q3);

      const session1Questions = actions.getBySession("session-1");
      expect(session1Questions).toHaveLength(2);
      expect(session1Questions.map(q => q.id)).toContain("q-1");
      expect(session1Questions.map(q => q.id)).toContain("q-2");
    });
  });

  describe("getPending", () => {
    it("returns only pending questions", () => {
      const [, actions] = createQuestionStore();
      const pending = createSampleQuestion({ id: "q-1", status: "pending" });
      const answered = createSampleQuestion({ id: "q-2", status: "answered", answer: "Yes" });

      actions.add(pending);
      actions.add(answered);

      const pendingQuestions = actions.getPending();
      expect(pendingQuestions).toHaveLength(1);
      expect(pendingQuestions[0].id).toBe("q-1");
    });
  });

  describe("getById", () => {
    it("returns question by ID", () => {
      const [, actions] = createQuestionStore();
      const question = createSampleQuestion();
      actions.add(question);

      expect(actions.getById("q-1")).toEqual(
        expect.objectContaining({
          ...question,
          questions: [
            {
              question: question.question,
              options: question.options?.map(label => ({ label })),
            },
          ],
        })
      );
    });

    it("returns undefined for non-existent ID", () => {
      const [, actions] = createQuestionStore();
      expect(actions.getById("non-existent")).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes question from byId", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion();
      actions.add(question);

      actions.remove("q-1");

      expect(state.byId["q-1"]).toBeUndefined();
    });

    it("removes question from session grouping", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion();
      actions.add(question);

      actions.remove("q-1");

      expect(state.bySession["session-1"]).not.toContain("q-1");
    });

    it("removes question from pendingOrder", () => {
      const [state, actions] = createQuestionStore();
      const question = createSampleQuestion({ status: "pending" });
      actions.add(question);

      actions.remove("q-1");

      expect(state.pendingOrder).not.toContain("q-1");
    });
  });

  describe("clearAnswered", () => {
    it("removes answered questions for session", () => {
      const [state, actions] = createQuestionStore();
      const pending = createSampleQuestion({ id: "q-1", status: "pending" });
      const answered = createSampleQuestion({ id: "q-2", status: "answered", answer: "Yes" });

      actions.add(pending);
      actions.add(answered);

      actions.clearAnswered("session-1");

      expect(state.byId["q-1"]).toBeDefined(); // pending remains
      expect(state.byId["q-2"]).toBeUndefined(); // answered removed
    });
  });
});
