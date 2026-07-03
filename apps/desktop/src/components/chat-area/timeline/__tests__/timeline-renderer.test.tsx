import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vite-plus/test";
import type { MessagePart } from "~/stores/types.ts";
import { TimelineRenderer } from "../timeline-renderer.tsx";

const thinking = (text: string): MessagePart => ({ type: "thinking", text });
const read = (id: string, file: string): MessagePart => ({
  input: { file_path: file },
  status: "done",
  toolCallId: id,
  toolName: "read",
  type: "tool_call",
});
const edit = (id: string): MessagePart => ({
  input: { file_path: "a.ts" },
  status: "done",
  toolCallId: id,
  toolName: "edit",
  type: "tool_call",
});
const text = (t: string): MessagePart => ({ type: "text", text: t });

describe("TimelineRenderer", () => {
  it("renders thinking steps", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[thinking("hmm")]} />
    ));
    expect(container.querySelector("[data-component='timeline-step']")).not.toBeNull();
  });

  it("renders explore group for consecutive reads", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[read("r1", "a.ts"), read("r2", "b.ts")]} />
    ));
    expect(container.querySelector("[data-component='collapsible-step']")).not.toBeNull();
    expect(container.textContent).toContain("Explored 2 files");
  });

  it("renders tool steps for non-explore tools", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[edit("e1")]} />
    ));
    expect(container.querySelector("[data-component='tool-summary-row']")).not.toBeNull();
  });

  it("renders connector lines on all but last step", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[thinking("a"), thinking("b"), thinking("c")]} />
    ));
    expect(container.querySelectorAll("[data-slot='timeline-connector']")).toHaveLength(2);
  });

  it("renders nothing for empty parts", () => {
    const { container } = render(() => <TimelineRenderer isStreaming={false} parts={[]} />);
    expect(container.querySelector("[data-component='timeline-step']")).toBeNull();
  });

  it("skips empty text/thinking parts", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[text("   "), thinking("  ")]} />
    ));
    expect(container.querySelector("[data-component='timeline-step']")).toBeNull();
  });

  it("renders compaction parts via the part registry instead of dropping them", () => {
    const { container } = render(() => (
      <TimelineRenderer
        isStreaming={false}
        parts={[{ type: "compaction", status: "complete", text: "summarized context" }]}
      />
    ));
    // Wrapped in a timeline step — not silently dropped.
    expect(container.querySelector("[data-component='timeline-step']")).not.toBeNull();
  });

  it("renders om_marker parts via the part registry instead of dropping them", () => {
    const { container } = render(() => (
      <TimelineRenderer
        isStreaming={false}
        parts={[
          {
            type: "om_marker",
            cycleId: "c1",
            operationType: "observation",
            status: "complete",
          },
        ]}
      />
    ));
    expect(container.querySelector("[data-component='timeline-step']")).not.toBeNull();
  });

  it("does NOT remount steps when parts are re-passed with the same references", () => {
    // Direct proof: <For> with stable wrappers preserves the same DOM nodes.
    // If wrappers were recreated, <For> would replace the node and identity would change.
    const t1 = thinking("a");
    const e1 = edit("e1");
    const [parts, setParts] = createSignal<MessagePart[]>([t1, e1]);

    const { container } = render(() => <TimelineRenderer isStreaming={false} parts={parts()} />);
    const stepNodesBefore = Array.from(
      container.querySelectorAll("[data-component='timeline-step']"),
    );
    expect(stepNodesBefore).toHaveLength(2);

    // Re-pass a NEW array container holding the SAME part references (this is
    // exactly what happens when the parent memo re-evaluates).
    setParts([t1, e1]);
    setParts([t1, e1]);

    const stepNodesAfter = container.querySelectorAll("[data-component='timeline-step']");
    expect(stepNodesAfter).toHaveLength(2);
    // Same DOM nodes — no remount.
    expect(stepNodesAfter[0]).toBe(stepNodesBefore[0]);
    expect(stepNodesAfter[1]).toBe(stepNodesBefore[1]);
  });

  it("keeps existing step DOM nodes when a new part is appended", () => {
    const t1 = thinking("a");
    const e1 = edit("e1");
    const [parts, setParts] = createSignal<MessagePart[]>([t1, e1]);

    const { container } = render(() => <TimelineRenderer isStreaming={false} parts={parts()} />);
    const firstBefore = container.querySelector("[data-component='timeline-step']");
    const secondBefore = container.querySelectorAll("[data-component='timeline-step']")[1];

    // Append a new part; existing two steps persist (same nodes), one added.
    setParts([t1, e1, edit("e2")]);
    const steps = container.querySelectorAll("[data-component='timeline-step']");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe(firstBefore);
    expect(steps[1]).toBe(secondBefore);
  });
});
