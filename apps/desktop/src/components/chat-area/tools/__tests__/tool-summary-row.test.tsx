import { render } from "@solidjs/testing-library";
import { FiCheck } from "solid-icons/fi";
import { describe, expect, it } from "vite-plus/test";
import type { ToolIconCmp, ToolPartData } from "../store.tsx";
import { ToolSummaryRow } from "../tool-summary-row.tsx";

const IconCmp: ToolIconCmp = () => <FiCheck />;
const part: ToolPartData = { tool: "read" };

describe("ToolSummaryRow", () => {
  it("renders the icon when showIcon is not false", () => {
    const { container } = render(() => (
      <ToolSummaryRow icon={IconCmp} part={part} status="completed" summary="Read file.ts" />
    ));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-slot="summary-main"]')?.textContent).toContain(
      "Read file.ts",
    );
  });

  it("hides the icon when showIcon is false", () => {
    const { container } = render(() => (
      <ToolSummaryRow
        icon={IconCmp}
        part={part}
        showIcon={false}
        status="completed"
        summary="Read file.ts"
      />
    ));
    expect(container.querySelector("svg")).toBeNull();
  });
});
