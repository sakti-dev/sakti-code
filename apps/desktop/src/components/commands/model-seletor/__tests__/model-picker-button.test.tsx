import { render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPickerButton } from "../model-picker-button";

const mocks = vi.hoisted(() => ({
  connectedGet: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: {
      api: {
        models: {
          connected: { $get: mocks.connectedGet },
        },
      },
    },
  }),
}));

const mockSections = [
  {
    providerId: "openai",
    providerName: "OpenAI",
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        status: "active" as const,
        reasoning: false,
      },
      { id: "o1", name: "o1", status: "active" as const, reasoning: true },
    ],
  },
];

describe("ModelPickerButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders trigger button when models are available", async () => {
    mocks.connectedGet.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSections),
    });

    render(() => (
      <ModelPickerButton
        onSelect={vi.fn()}
        triggerLabel={() => "GPT-4o"}
        value="gpt-4o"
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("GPT-4o")).toBeTruthy();
    });
  });

  it("opens dialog on trigger click", async () => {
    mocks.connectedGet.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSections),
    });

    render(() => (
      <ModelPickerButton
        onSelect={vi.fn()}
        triggerLabel={() => "GPT-4o"}
        value="gpt-4o"
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("GPT-4o")).toBeTruthy();
    });

    screen.getByText("GPT-4o").click();

    await waitFor(() => {
      expect(screen.getByText("Selecting model")).toBeTruthy();
    });
  });

  it("renders model options in the opened dialog", async () => {
    mocks.connectedGet.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSections),
    });

    render(() => (
      <ModelPickerButton
        onSelect={vi.fn()}
        triggerLabel={() => "GPT-4o"}
        value="gpt-4o"
      />
    ));

    await waitFor(() => {
      expect(screen.getByText("GPT-4o")).toBeTruthy();
    });

    screen.getByText("GPT-4o").click();

    await waitFor(() => {
      expect(screen.getByText("Selecting model")).toBeTruthy();
    });

    // Model names appear in the dialog
    expect(screen.getByText("o1")).toBeTruthy();
  });

  it("does not render button when API returns empty sections", async () => {
    mocks.connectedGet.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    render(() => (
      <ModelPickerButton
        onSelect={vi.fn()}
        triggerLabel={() => "GPT-4o"}
        value=""
      />
    ));

    await waitFor(() => {
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
