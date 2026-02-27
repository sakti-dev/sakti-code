import {
  listPendingQuestionsUsecase,
  rejectQuestionUsecase,
  replyQuestionUsecase,
} from "../../application/usecases/manage-questions.usecase.js";

export function buildQuestionUsecases() {
  return {
    listPendingQuestionsUsecase,
    replyQuestionUsecase,
    rejectQuestionUsecase,
  };
}
