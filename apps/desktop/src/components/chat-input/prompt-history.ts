export interface HistoryNavState {
  index: number;
  draft: string;
}

export const initialHistoryNav: HistoryNavState = { index: -1, draft: "" };

export function historyUp(state: HistoryNavState, list: string[], draft: string): HistoryNavState {
  if (list.length === 0) {
    return state;
  }
  if (state.index === -1) {
    return { index: 0, draft };
  }
  return { ...state, index: Math.min(state.index + 1, list.length - 1) };
}

export function historyDown(state: HistoryNavState): HistoryNavState {
  if (state.index === -1) {
    return state;
  }
  const next = state.index - 1;
  if (next < 0) {
    return { index: -1, draft: state.draft };
  }
  return { ...state, index: next };
}

export function historyCurrent(state: HistoryNavState, list: string[]): string | null {
  if (state.index === -1) {
    return null;
  }
  return list[state.index] ?? null;
}
