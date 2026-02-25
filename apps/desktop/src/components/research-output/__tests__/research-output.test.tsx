import { ResearchOutput } from "@/components/research-output/research-output";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("ResearchOutput", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders loading state", () => {
    const { container } = render(() => <ResearchOutput loading={true} />);

    expect(container.textContent).toContain("Researching your request");
  });

  it("renders summary and action buttons", () => {
    const onAction = vi.fn();
    const { container } = render(() => (
      <ResearchOutput
        summary="I found two implementation paths."
        buttons={[
          {
            id: "b1",
            label: "Comprehensive",
            action: "wizard:start:comprehensive",
            variant: "primary",
          },
        ]}
        onAction={onAction}
      />
    ));

    expect(container.textContent).toContain("I found two implementation paths.");
    const button = container.querySelector('button[data-action="wizard:start:comprehensive"]') as HTMLButtonElement;
    expect(button).not.toBeNull();

    button.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      "wizard:start:comprehensive",
      expect.objectContaining({ id: "b1" })
    );
  });
});
