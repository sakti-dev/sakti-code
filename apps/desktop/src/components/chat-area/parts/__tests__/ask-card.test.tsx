import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { AskCard } from "../ask-card.tsx";

describe("AskCard", () => {
  it("renders the mission-destination copy with Create/Revise buttons", () => {
    render(() => <AskCard to="mission" body="brief" onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Proposed Mission")).toBeTruthy();
    expect(screen.getByText("Create")).toBeTruthy();
    expect(screen.getByText("Revise")).toBeTruthy();
  });

  it("renders the build-destination copy with Approve/Revise buttons", () => {
    render(() => <AskCard to="build" body="spec" onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Proposed Spec")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("renders the archive-destination copy with Archive/Request changes buttons", () => {
    render(() => <AskCard to="archive" body="done" onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Ready to Archive")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
    expect(screen.getByText("Request changes")).toBeTruthy();
  });

  it("fires onApprove when the approve button is clicked", () => {
    const onApprove = vi.fn();
    render(() => <AskCard to="build" body="p" onApprove={onApprove} onReject={() => {}} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("fires onReject when the reject button is clicked", () => {
    const onReject = vi.fn();
    render(() => <AskCard to="build" body="p" onApprove={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByText("Revise"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("renders the body", () => {
    render(() => (
      <AskCard
        to="mission"
        body="a self-contained brief"
        onApprove={() => {}}
        onReject={() => {}}
      />
    ));
    expect(screen.getByText("a self-contained brief")).toBeTruthy();
  });
});
