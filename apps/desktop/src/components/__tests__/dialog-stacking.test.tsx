import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent } from "~/components/ui/dialog";

function contentFor(testId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`content ${testId} not mounted`);
  return el;
}

const visibleOverlays = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-stack-overlay]")
  ).filter((el) => el.dataset.stackedHidden === undefined);

const overlays = () =>
  document.querySelectorAll<HTMLElement>("[data-stack-overlay]");

describe("dialog stacking", () => {
  it("hides the lower dialog when a second opens on top", async () => {
    const [openA, setOpenA] = createSignal(true);
    const [openB, setOpenB] = createSignal(false);
    render(() => (
      <>
        <Dialog onOpenChange={setOpenA} open={openA()}>
          <DialogContent data-testid="a">A_BODY</DialogContent>
        </Dialog>
        <Dialog onOpenChange={setOpenB} open={openB()}>
          <DialogContent data-testid="b">B_BODY</DialogContent>
        </Dialog>
      </>
    ));

    // A open alone → visible
    expect(contentFor("a").dataset.stackedHidden).toBeUndefined();

    // open B on top of A
    setOpenB(true);
    await Promise.resolve();

    expect(contentFor("a").dataset.stackedHidden).toBe("true");
    expect(contentFor("b").dataset.stackedHidden).toBeUndefined();
    // only the topmost overlay should be visible (no doubled backdrop)
    expect(overlays().length).toBe(2);
    expect(visibleOverlays().length).toBe(1);

    // close B → A visible again
    setOpenB(false);
    await Promise.resolve();
    expect(contentFor("a").dataset.stackedHidden).toBeUndefined();
    expect(visibleOverlays().length).toBe(1);
  });
});
