import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { AskCard } from "../ask-card.tsx";

describe("AskCard", () => {
  it("renders the session-kind copy with Create/Revise buttons", () => {
    render(() => <AskCard kind="session" body="brief" onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Proposed Session")).toBeTruthy();
    expect(screen.getByText("Create")).toBeTruthy();
    expect(screen.getByText("Revise")).toBeTruthy();
  });

  it("renders the plan-kind copy with Approve/Revise buttons", () => {
    render(() => <AskCard kind="plan" body="plan" onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Proposed Plan")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("renders the completion-kind copy with Merge/Request changes buttons", () => {
    render(() => (
      <AskCard kind="completion" body="done" onApprove={() => {}} onReject={() => {}} />
    ));
    expect(screen.getByText("Ready for Review")).toBeTruthy();
    expect(screen.getByText("Merge")).toBeTruthy();
    expect(screen.getByText("Request changes")).toBeTruthy();
  });

  it("fires onApprove when the approve button is clicked", () => {
    const onApprove = vi.fn();
    render(() => <AskCard kind="plan" body="p" onApprove={onApprove} onReject={() => {}} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("fires onReject when the reject button is clicked", () => {
    const onReject = vi.fn();
    render(() => <AskCard kind="plan" body="p" onApprove={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByText("Revise"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("renders the body", () => {
    render(() => (
      <AskCard
        kind="session"
        body="a self-contained brief"
        onApprove={() => {}}
        onReject={() => {}}
      />
    ));
    expect(screen.getByText("a self-contained brief")).toBeTruthy();
  });
});
