TanStack AI does not natively support Mastra workflow streams out-of-the-box, but integration is feasible through custom connection adapters that transform Mastra's streaming protocol into TanStack AI's `AsyncIterable<StreamChunk>` format. [tanstack](https://tanstack.com/ai/latest/docs/guides/streaming)

Mastra's streams (via `stream()`, `fullStream`, or `streamVNext()`) can be customized using utilities like `toAISdkV5Stream()` as a base, then adapted for TanStack AI by parsing chunks into `StreamChunk` objects with `delta`, `usage`, or `reasoning` properties. [mastra](https://mastra.ai/blog/changelog-2025-09-25)

## Customization Steps

Create a server API route (e.g., in Next.js or TanStack Start) that executes Mastra workflows/agents and converts their output:

1. Import Mastra agent/workflow and TanStack AI primitives: `import { stream } from '@tanstack/ai-react'; import { mastra } from './mastra';` [mastra](https://mastra.ai/guides/build-your-ui/ai-sdk-ui)
2. Define a custom `ConnectionAdapter`: Use `stream(async (messages, data) => { const run = mastra.getWorkflow('myWorkflow').createRun({ inputData: data }); const mastraStream = await run.fullStream(); return mastraToTanStackChunks(mastraStream); })` where `mastraToTanStackChunks` parses SSE/NDJSON events into `{ type: 'text-delta', delta: 'text...' }`. [github](https://github.com/ataschz/tanstack-start-mastra-example)
3. Expose as SSE endpoint: Return `toServerSentEventsStream(adapterStream)` for client-side `useChat({ connection: fetchServerSentEvents('/api/chat') })`. [mastra](https://mastra.ai)

## Example Code Snippet

```typescript
// api/chat.ts
import { streamText } from "@tanstack/ai"; // Adapt similarly
import { mastra } from "@/mastra";

const adapter = stream(async (messages, data) => {
  const workflow = mastra.getWorkflow("myWorkflow");
  const run = workflow.createRun({ inputData: data });
  const mastraStream = run.fullStream(); // Mastra AsyncIterable
  return convertMastraToChunks(mastraStream); // Custom converter to StreamChunk[]
});

export async function POST(req) {
  const { messages } = await req.json();
  return adapter.connect(messages);
}
```

See GitHub examples like `ataschz/tanstack-start-mastra-example` for full demos adapting Mastra streams in TanStack Start apps. [github](https://github.com/retrip-ai/mastra-example)

## Key Differences

| Feature    | Mastra Streams                                                                          | TanStack AI Chunks                                                                                      |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Format     | NDJSON/SSE with `data-workflow` [mastra](https://mastra.ai/docs/streaming/overview)     | `AsyncIterable<StreamChunk>` [tanstack](https://tanstack.com/ai/latest/docs/guides/connection-adapters) |
| Tool Calls | Nested workflow progress [mastra](https://mastra.ai/blog/changelog-2025-09-25)          | `tools: { call: {...} }` deltas [tanstack](https://tanstack.com/ai/latest/docs/guides/streaming)        |
| Adapter    | Custom parser needed [github](https://github.com/ataschz/tanstack-start-mastra-example) | Built-in SSE/fetchHttpStream [mastra](https://mastra.ai)                                                |
