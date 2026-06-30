import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ConnectedProvidersList } from "../connected-providers-list";

interface Provider {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

function providers(ids: string[]): Provider[] {
  return ids.map((id, i) => ({
    id,
    name: id === "anthropic" ? "Anthropic" : `Provider ${id}`,
    modelCount: (i + 1) * 5,
    connected: true,
  }));
}

describe("ConnectedProvidersList", () => {
  it("shows loading state before data is loaded", () => {
    render(() => (
      <ConnectedProvidersList
        hasLoaded={false}
        onDisconnect={vi.fn()}
        onOpenModal={vi.fn()}
        providers={[]}
      />
    ));
    expect(screen.getByText("Loading providers...")).toBeTruthy();
  });

  it("shows empty state when no providers are connected", () => {
    render(() => (
      <ConnectedProvidersList
        hasLoaded={true}
        onDisconnect={vi.fn()}
        onOpenModal={vi.fn()}
        providers={[]}
      />
    ));
    expect(screen.getByText("No provider connected yet.")).toBeTruthy();
    expect(screen.getByText("Select provider")).toBeTruthy();
  });

  it("lists connected providers with names and model counts", () => {
    render(() => (
      <ConnectedProvidersList
        hasLoaded={true}
        onDisconnect={vi.fn()}
        onOpenModal={vi.fn()}
        providers={providers(["anthropic", "openai"])}
      />
    ));
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("5 models")).toBeTruthy();
    expect(screen.getByText("Provider openai")).toBeTruthy();
    expect(screen.getByText("10 models")).toBeTruthy();
  });

  it("calls onOpenModal() when 'Connect a provider' is clicked", () => {
    const onOpenModal = vi.fn();
    render(() => (
      <ConnectedProvidersList
        hasLoaded={true}
        onDisconnect={vi.fn()}
        onOpenModal={onOpenModal}
        providers={providers(["anthropic"])}
      />
    ));
    fireEvent.click(screen.getByText("Connect a provider"));
    expect(onOpenModal).toHaveBeenCalledWith();
  });

  it("calls onOpenModal() when 'Select provider' is clicked in empty state", () => {
    const onOpenModal = vi.fn();
    render(() => (
      <ConnectedProvidersList
        hasLoaded={true}
        onDisconnect={vi.fn()}
        onOpenModal={onOpenModal}
        providers={[]}
      />
    ));
    fireEvent.click(screen.getByText("Select provider"));
    expect(onOpenModal).toHaveBeenCalledWith();
  });

  it("calls onOpenModal(providerId) when 'Manage' is clicked", () => {
    const onOpenModal = vi.fn();
    render(() => (
      <ConnectedProvidersList
        hasLoaded={true}
        onDisconnect={vi.fn()}
        onOpenModal={onOpenModal}
        providers={providers(["anthropic"])}
      />
    ));
    fireEvent.click(screen.getByText("Manage"));
    expect(onOpenModal).toHaveBeenCalledWith("anthropic");
  });

  it("calls onDisconnect(providerId) when 'Disconnect' is clicked", () => {
    const onDisconnect = vi.fn();
    render(() => (
      <ConnectedProvidersList
        hasLoaded={true}
        onDisconnect={onDisconnect}
        onOpenModal={vi.fn()}
        providers={providers(["anthropic"])}
      />
    ));
    fireEvent.click(screen.getByText("Disconnect"));
    expect(onDisconnect).toHaveBeenCalledWith("anthropic");
  });
});
