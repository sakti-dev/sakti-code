import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { ToolSummaryRow } from "../tool-summary-row.tsx";

describe("ToolSummaryRow showIcon", () => {
  it("renders icon by default", () => {
    const { container } = render(() => (
      <ToolSummaryRow icon="file" status="completed" summary="Read file.ts" />
    ));
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("hides icon when showIcon=false", () => {
    const { container } = render(() => (
      <ToolSummaryRow icon="file" showIcon={false} status="completed" summary="Read file.ts" />
    ));
    expect(container.querySelector("svg")).toBeNull();
  });
});
