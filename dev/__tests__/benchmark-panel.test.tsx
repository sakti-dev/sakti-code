import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../app";

describe("playground benchmark panel", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports append and rewrite benchmark results with progress", async () => {
		vi.useFakeTimers();

		const container = document.createElement("div");
		document.body.append(container);

		const dispose = render(() => <App />, container);
		const runButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Run benchmark"),
		) as HTMLButtonElement;

		expect(runButton).toBeTruthy();

		runButton.click();

		await vi.advanceTimersByTimeAsync(0);
		expect(container.textContent).toContain("Running 1 / 2");

		await vi.advanceTimersByTimeAsync(1000);

		expect(container.textContent).toContain("Completed");
		expect(container.textContent).toContain("Benchmark");
		expect(container.textContent).toContain("2 runs");

		dispose();
		container.remove();
	}, 15_000);
});
