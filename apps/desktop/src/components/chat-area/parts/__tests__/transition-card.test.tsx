import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { TransitionCard } from "../transition-card.tsx";

describe("TransitionCard", () => {
  it("renders the mission-destination copy with Create/Revise buttons", () => {
    render(() => (
      <TransitionCard to="mission" body="brief" onApprove={() => {}} onReject={() => {}} />
    ));
    expect(screen.getByText("Proposed Mission")).toBeTruthy();
    expect(screen.getByText("Create")).toBeTruthy();
    expect(screen.getByText("Revise")).toBeTruthy();
  });

  it("renders the build-destination copy with Approve/Revise buttons", () => {
    render(() => (
      <TransitionCard to="build" body="spec" onApprove={() => {}} onReject={() => {}} />
    ));
    expect(screen.getByText("Proposed Spec")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("renders the archive-destination copy with Archive/Request changes buttons", () => {
    render(() => (
      <TransitionCard to="archive" body="done" onApprove={() => {}} onReject={() => {}} />
    ));
    expect(screen.getByText("Ready to Archive")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
    expect(screen.getByText("Request changes")).toBeTruthy();
  });

  it("fires onApprove when the approve button is clicked", () => {
    const onApprove = vi.fn();
    render(() => <TransitionCard to="build" body="p" onApprove={onApprove} onReject={() => {}} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("disables approve while approval is pending", () => {
    const onApprove = vi.fn();
    render(() => (
      <TransitionCard
        to="mission"
        body="p"
        onApprove={onApprove}
        onReject={() => {}}
        approveDisabled={true}
      />
    ));
    const create = screen.getByText("Create") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("fires onReject when the reject button is clicked", () => {
    const onReject = vi.fn();
    render(() => <TransitionCard to="build" body="p" onApprove={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByText("Revise"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("renders the done-destination copy with Finish/Keep buttons", () => {
    render(() => (
      <TransitionCard to="done" body="Archive complete." onApprove={() => {}} onReject={() => {}} />
    ));
    expect(screen.getByText("Archive Complete")).toBeTruthy();
    expect(screen.getByText("Finish & Remove Worktree")).toBeTruthy();
    expect(screen.getByText("Keep")).toBeTruthy();
  });

  it("renders the body", () => {
    render(() => (
      <TransitionCard
        to="mission"
        body="a self-contained brief"
        onApprove={() => {}}
        onReject={() => {}}
      />
    ));
    expect(screen.getByText("a self-contained brief")).toBeTruthy();
  });
});
