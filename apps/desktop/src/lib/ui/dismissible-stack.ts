const CONTENT_SELECTOR = "[data-stack-content]";
const OVERLAY_SELECTOR = "[data-stack-overlay]";

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (hidden) {
    el.dataset.stackedHidden = "true";
    el.classList.add("opacity-0", "pointer-events-none");
  } else {
    delete el.dataset.stackedHidden;
    el.classList.remove("opacity-0", "pointer-events-none");
  }
}

/**
 * Hide every open dialog except the topmost — both content and overlay.
 *
 * Every open dialog portals into `document.body` in open order, so the
 * last `[data-stack-content]` in the DOM is the topmost. Its `stackId`
 * identifies which overlay belongs to it; every other overlay is hidden
 * too, so backdrops don't stack up and double-darken.
 */
export function recomputeDialogStack(): void {
  const contents = Array.from(
    document.querySelectorAll<HTMLElement>(CONTENT_SELECTOR)
  );
  const topId = contents.at(-1)?.dataset.stackContent;

  console.log(
    "[DIALOG STACK] recompute, count=",
    contents.length,
    "top=",
    topId
  );

  for (let i = 0; i < contents.length; i++) {
    const el = contents[i];
    if (!el) {
      continue;
    }
    const hidden = i !== contents.length - 1;
    console.log(
      "[DIALOG STACK]",
      el.dataset.stackContent,
      "content ->",
      hidden ? "HIDDEN" : "visible"
    );
    setHidden(el, hidden);
  }

  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)
  );
  for (const ov of overlays) {
    if (!ov) {
      continue;
    }
    const hidden = ov.dataset.stackOverlay !== topId;
    console.log(
      "[DIALOG STACK]",
      ov.dataset.stackOverlay,
      "overlay ->",
      hidden ? "HIDDEN" : "visible"
    );
    setHidden(ov, hidden);
  }
}

function hasStackNode(node: Node): boolean {
  if (node.nodeType !== 1) {
    return false;
  }
  const el = node as HTMLElement;
  const matches = Boolean(
    el.matches?.(CONTENT_SELECTOR) || el.matches?.(OVERLAY_SELECTOR)
  );
  const contains = Boolean(
    el.querySelector?.(`${CONTENT_SELECTOR}, ${OVERLAY_SELECTOR}`)
  );
  return Boolean(matches) || contains;
}

let started = false;

/**
 * Watch `document.body` for dialog content/overlay being added/removed and
 * recompute the stack then. Decouples us from framework mount/animation
 * timing — we react to the DOM itself. Idempotent.
 */
export function startDialogStackObserver(): void {
  if (started || typeof document === "undefined") {
    return;
  }
  started = true;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const touched = [...m.addedNodes, ...m.removedNodes].some(hasStackNode);
      if (touched) {
        recomputeDialogStack();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[DIALOG STACK] observer started");
}
