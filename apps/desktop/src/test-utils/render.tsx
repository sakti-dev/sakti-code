import { render } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { TestProviders } from "../../tests/helpers/test-providers";

export function renderWithProviders(ui: () => JSX.Element) {
  return render(() => <TestProviders>{ui()}</TestProviders>);
}
