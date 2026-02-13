import { runWithFrameBudget, type FrameBudgetRunResult } from "@/core/shared/utils";

export interface MarkdownFinalizerOptions {
  chunkSize: number;
  frameBudgetMs: number;
}

export interface MarkdownFinalizerResult extends FrameBudgetRunResult {
  html: string;
}

export function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const pushCurrent = () => {
    if (current.length === 0) return;
    blocks.push(current.join("\n"));
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      current.push(line);
      continue;
    }

    if (!inFence && trimmed === "") {
      pushCurrent();
      continue;
    }

    current.push(line);
  }

  pushCurrent();
  return blocks.length > 0 ? blocks : [markdown];
}

export async function finalizeMarkdownInChunks(
  markdown: string,
  parse: (block: string) => Promise<string>,
  sanitize: (html: string) => Promise<string>,
  options: MarkdownFinalizerOptions
): Promise<MarkdownFinalizerResult> {
  const blocks = splitMarkdownBlocks(markdown);
  const rendered: string[] = [];
  let index = 0;

  const stats = await runWithFrameBudget(
    async () => {
      if (index >= blocks.length) return true;

      for (let i = 0; i < options.chunkSize && index < blocks.length; i += 1, index += 1) {
        const parsed = await parse(blocks[index] ?? "");
        const sanitized = await sanitize(parsed);
        rendered.push(sanitized);
      }

      return index >= blocks.length;
    },
    { frameBudgetMs: options.frameBudgetMs }
  );

  return {
    ...stats,
    html: rendered.join("\n"),
  };
}
