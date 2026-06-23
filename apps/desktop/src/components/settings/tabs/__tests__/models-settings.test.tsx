import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsSettings } from "../models-settings.tsx";

const mocks = vi.hoisted(() => ({
  $delete: vi.fn(),
  $get: vi.fn(),
  $post: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: {
      api: {
        auth: {
          $get: mocks.$get,
          ":provider": {
            $post: mocks.$post,
            $delete: mocks.$delete,
          },
        },
      },
    },
  }),
}));

function okRes(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function errRes() {
  return Promise.resolve({
    ok: false,
    json: () => Promise.resolve(null),
  });
}

function authEntries(connected: string[] = []) {
  const all = ["anthropic", "openai"];
  return all.map((provider) => ({
    provider,
    hasKey: connected.includes(provider),
    maskedKey: connected.includes(provider) ? "...XXXX" : null,
  }));
}

describe("ModelsSettings", () => {
  beforeEach(() => {
    mocks.$get.mockReset();
    mocks.$post.mockReset();
    mocks.$delete.mockReset();
  });

  it("calls GET /api/auth on mount", async () => {
    mocks.$get.mockImplementation(() => okRes(authEntries()));
    render(() => <ModelsSettings />);
    await vi.waitFor(() => expect(mocks.$get).toHaveBeenCalledOnce());
  });

  it("shows empty state when no provider is connected", async () => {
    mocks.$get.mockImplementation(() => okRes(authEntries()));
    render(() => <ModelsSettings />);
    expect(await screen.findByText("No provider connected yet.")).toBeTruthy();
  });

  it("lists connected providers", async () => {
    mocks.$get.mockImplementation(() => okRes(authEntries(["anthropic"])));
    render(() => <ModelsSettings />);
    expect(await screen.findByText("Anthropic")).toBeTruthy();
    expect(screen.queryByText("No provider connected yet.")).toBeNull();
  });

  it("connects via POST /api/auth/:provider with { param, json }", async () => {
    mocks.$get.mockImplementation(() => okRes(authEntries()));
    render(() => <ModelsSettings />);

    await screen.findByText("No provider connected yet.");
    fireEvent.click(await screen.findByText("Connect a provider"));

    const input = (await screen.findByPlaceholderText(
      "API key"
    )) as HTMLInputElement;
    input.value = "sk-test-key";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    mocks.$post.mockImplementation(() => okRes(null));
    fireEvent.click(await screen.findByText("Connect"));

    await vi.waitFor(() => {
      expect(mocks.$post).toHaveBeenCalledWith({
        param: { provider: "anthropic" },
        json: { key: "sk-test-key" },
      });
    });
  });

  it("disconnects via DELETE /api/auth/:provider", async () => {
    mocks.$get.mockImplementation(() => okRes(authEntries(["anthropic"])));
    render(() => <ModelsSettings />);

    mocks.$delete.mockImplementation(() => okRes(null));
    fireEvent.click(await screen.findByText("Disconnect"));

    await vi.waitFor(() => {
      expect(mocks.$delete).toHaveBeenCalledWith({
        param: { provider: "anthropic" },
      });
    });
  });

  it("shows error when connect fails", async () => {
    mocks.$get.mockImplementation(() => okRes(authEntries()));
    render(() => <ModelsSettings />);

    await screen.findByText("No provider connected yet.");
    fireEvent.click(await screen.findByText("Connect a provider"));

    const input = (await screen.findByPlaceholderText(
      "API key"
    )) as HTMLInputElement;
    input.value = "sk-test";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    mocks.$post.mockImplementation(() => errRes());
    fireEvent.click(await screen.findByText("Connect"));

    expect(await screen.findByText("Failed to save API key.")).toBeTruthy();
    expect(mocks.$post).toHaveBeenCalledOnce();
  });
});
