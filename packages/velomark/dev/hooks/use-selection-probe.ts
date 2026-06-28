import { createSignal } from "solid-js";

export interface SelectionProbeState {
  anchorBlockId: string | null;
  anchorBlockReplaced: boolean;
  anchorNodeConnected: boolean;
  hasSelection: boolean;
  statusMessage: string;
}

const INITIAL_STATE: SelectionProbeState = {
  anchorBlockId: null,
  anchorNodeConnected: false,
  anchorBlockReplaced: false,
  hasSelection: false,
  statusMessage: "No selection captured",
};

function statesEqual(
  left: SelectionProbeState,
  right: SelectionProbeState
): boolean {
  return (
    left.anchorBlockId === right.anchorBlockId &&
    left.anchorBlockReplaced === right.anchorBlockReplaced &&
    left.anchorNodeConnected === right.anchorNodeConnected &&
    left.hasSelection === right.hasSelection &&
    left.statusMessage === right.statusMessage
  );
}

function findAnchorBlock(selection: Selection | null): HTMLElement | null {
  const anchorNode = selection?.anchorNode;
  if (!anchorNode) {
    return null;
  }

  const element =
    anchorNode.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : anchorNode.parentElement;

  return element?.closest("[data-velomark-block-id]") as HTMLElement | null;
}

export function useSelectionProbe() {
  const [state, setState] = createSignal(INITIAL_STATE);
  let anchorNode: Node | null = null;

  const probeSelection = () => {
    const selection = window.getSelection();
    const anchorBlock = findAnchorBlock(selection);
    anchorNode = selection?.anchorNode ?? null;

    if (!(anchorNode && anchorBlock)) {
      setState((previous) =>
        statesEqual(previous, INITIAL_STATE) ? previous : INITIAL_STATE
      );
      return;
    }

    const nextState = {
      anchorBlockId: anchorBlock.dataset.velomarkBlockId ?? null,
      anchorBlockReplaced: false,
      anchorNodeConnected: anchorNode.isConnected,
      hasSelection: true,
      statusMessage: anchorNode.isConnected
        ? "Selection stable"
        : "Selection replaced",
    };

    setState((previous) =>
      statesEqual(previous, nextState) ? previous : nextState
    );
  };

  const reevaluateSelection = (
    rendererSurface: HTMLElement | null | undefined
  ) => {
    const previousState = state();
    if (
      !(previousState.hasSelection && previousState.anchorBlockId && anchorNode)
    ) {
      return;
    }

    const anchorBlock = rendererSurface?.querySelector(
      `[data-velomark-block-id="${previousState.anchorBlockId}"]`
    );
    const anchorNodeConnected =
      anchorNode.isConnected && Boolean(rendererSurface?.contains(anchorNode));
    const anchorBlockReplaced = !anchorBlock;

    const nextState = {
      anchorBlockId: previousState.anchorBlockId,
      anchorBlockReplaced,
      anchorNodeConnected,
      hasSelection: true,
      statusMessage:
        anchorNodeConnected && !anchorBlockReplaced
          ? "Selection stable"
          : "Selection replaced",
    };

    setState((previous) =>
      statesEqual(previous, nextState) ? previous : nextState
    );
  };

  return {
    probeSelection,
    reevaluateSelection,
    selectionProbeState: state,
  };
}
