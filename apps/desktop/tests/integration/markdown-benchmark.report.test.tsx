import { Markdown } from "@/components/ui/markdown";
import {
  getMarkdownPerfSnapshot,
  resetMarkdownPerfTelemetry,
} from "@/core/chat/services/markdown-perf-telemetry";
import { render } from "@solidjs/testing-library";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRecordedTextDeltaSequence } from "../fixtures/performance-fixtures";

function sleep(ms: number): Promise<void> {
  return new Promise(resolveDone => setTimeout(resolveDone, ms));
}

function buildScenario(): string {
  const deltas = createRecordedTextDeltaSequence(180);
  const body = deltas.join("").replaceAll(/[.!?]/g, "");
  const streamHeavy = `${body} ${"streaming load ".repeat(40)}`;
  return `${body}
\n\n${streamHeavy}
\n### Example
\n\`\`\`bash
pnpm --filter @sakti-code/desktop test:run
\`\`\`
`;
}

describe("Benchmark: markdown renderer report", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    resetMarkdownPerfTelemetry();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    container.remove();
    resetMarkdownPerfTelemetry();
  });

  it("emits benchmark metrics report for fixture replay", async () => {
    const markdown = buildScenario();
    const [text, setText] = createSignal("");
    const [isStreaming, setIsStreaming] = createSignal(true);

    ({ unmount: dispose } = render(() => (
      <Markdown
        text={text()}
        isStreaming={isStreaming()}
        streamCadenceMs={35}
        deferHighlightUntilComplete={true}
        streamLiteEnabled={true}
      />
    )));
    const chunk = 42;
    for (let i = 0; i < markdown.length; i += chunk) {
      setText(markdown.slice(0, i + chunk));
      await sleep(16);
    }

    setIsStreaming(false);
    await sleep(220);

    const report = {
      generatedAt: new Date().toISOString(),
      fixture: "chat-stream.from-log.json",
      snapshot: getMarkdownPerfSnapshot(),
    };

    const outputDir = resolve(process.cwd(), "tests/fixtures/recorded/perf-reports");
    mkdirSync(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, "markdown-benchmark.latest.json");
    writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    expect(report.snapshot.counters.commits).toBeGreaterThan(3);
    expect(report.snapshot.counters.liteCommits).toBeGreaterThan(0);
    expect(report.snapshot.counters.finalizationBatches).toBeGreaterThan(1);
    expect(report.snapshot.counters.finalizationMaxBatchMs).toBeLessThan(120);
  }, 20000);
});
