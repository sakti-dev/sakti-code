const CONTENT_SELECTOR = "[data-stack-content]";
const OVERLAY_SELECTOR = "[data-stack-overlay]";

const stackIds: string[] = [];

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
 * Walk up from `el` to find its portal wrapper — the element that is a
 * direct child of `document.body`. This is the `fixed inset-0 z-50` div
 * that Kobalte/SolidJS `<Portal>` appends to body. It's NOT tagged with
 * any `data-stack-*` attribute, so `setHidden` alone can't neutralize it.
 */
function findPortalWrapper(el: HTMLElement | null): HTMLElement | null {
  let node = el;
  while (node && node !== document.body) {
    const parent = node.parentElement;
    if (parent === document.body) {
      return node;
    }
    node = parent;
  }
  return null;
}

function setPortalWrapperHidden(
  contentEl: HTMLElement | null,
  hidden: boolean
): void {
  const wrapper = findPortalWrapper(contentEl);
  if (!wrapper) {
    console.log("[DIALOG STACK] no portal wrapper found");
    return;
  }
  if (hidden) {
    wrapper.classList.add("pointer-events-none");
    wrapper.style.pointerEvents = "";
    wrapper.removeAttribute("data-kb-top-layer");
    wrapper.dataset.stackedPortalHidden = "true";
  } else {
    wrapper.classList.remove("pointer-events-none");
    // Force inline pointer-events: auto to override Kobalte's
    // body.style.pointerEvents = "none" (set by modal dialogs).
    // Non-Kobalte dialogs (raw <Portal>) aren't in Kobalte's layer
    // stack, so they'd otherwise inherit "none" from body.
    wrapper.style.pointerEvents = "auto";
    // Mark as Kobalte "top layer" so lower dialogs' createInteractOutside
    // doesn't treat clicks on this dialog as "outside" and dismiss them.
    wrapper.setAttribute("data-kb-top-layer", "");
    delete wrapper.dataset.stackedPortalHidden;
  }
  console.log(
    "[DIALOG STACK] portal wrapper for",
    contentEl?.dataset.stackContent,
    "->",
    hidden ? "HIDDEN (pointer-events-none)" : "visible (pointer-events:auto)",
    "| style.pointerEvents:",
    wrapper.style.pointerEvents || "(empty)",
    "| data-kb-top-layer:",
    wrapper.hasAttribute("data-kb-top-layer"),
    "| body.pointerEvents:",
    document.body.style.pointerEvents || "(empty)"
  );
}

/**
 * Hide every open dialog except the topmost — both content and overlay.
 *
 * Maintains an explicit stack order (first-seen wins) rather than relying
 * on DOM order, which can shift when frameworks re-portal elements.
 */
export function recomputeDialogStack(): void {
  const contents = Array.from(
    document.querySelectorAll<HTMLElement>(CONTENT_SELECTOR)
  );
  const domIds = new Set(
    contents.map((el) => el.dataset.stackContent).filter(Boolean) as string[]
  );

  console.log(
    "[DIALOG STACK] recompute — tracked:",
    [...stackIds],
    "dom ids:",
    [...domIds]
  );

  for (let i = stackIds.length - 1; i >= 0; i--) {
    if (!domIds.has(stackIds[i])) {
      console.log("[DIALOG STACK] prune removed:", stackIds[i]);
      stackIds.splice(i, 1);
    }
  }

  for (const id of domIds) {
    if (!stackIds.includes(id)) {
      stackIds.push(id);
      console.log("[DIALOG STACK] register new (top):", id);
    }
  }

  const topId = stackIds.at(-1);

  console.log("[DIALOG STACK] final order:", [...stackIds], "topId:", topId);

  for (const id of stackIds) {
    const el = document.querySelector<HTMLElement>(
      `[data-stack-content="${id}"]`
    );
    if (!el) {
      continue;
    }
    const hidden = id !== topId;
    console.log(
      "[DIALOG STACK]",
      id,
      "content ->",
      hidden ? "HIDDEN" : "visible"
    );
    setHidden(el, hidden);
    setPortalWrapperHidden(el, hidden);
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
        console.log("[DIALOG STACK] mutation triggered recompute");
        recomputeDialogStack();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[DIALOG STACK] observer started");
}
