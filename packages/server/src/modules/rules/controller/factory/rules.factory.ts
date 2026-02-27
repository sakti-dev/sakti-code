import {
  addRuleUsecase,
  clearRulesUsecase,
  evaluateRuleUsecase,
  getDefaultRulesUsecase,
  getRulesConfigUsecase,
  listRulesUsecase,
  replaceRulesFromConfigUsecase,
  replaceRulesUsecase,
  resetRulesUsecase,
} from "../../application/usecases/manage-rules.usecase.js";

export function buildRuleUsecases() {
  return {
    listRulesUsecase,
    getRulesConfigUsecase,
    getDefaultRulesUsecase,
    replaceRulesUsecase,
    addRuleUsecase,
    replaceRulesFromConfigUsecase,
    resetRulesUsecase,
    clearRulesUsecase,
    evaluateRuleUsecase,
  };
}
