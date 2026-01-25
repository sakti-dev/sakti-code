# Shape: @tanstack-ai-mastra Adapter

**Date:** 2026-01-26

---

## Shaping Decisions

### Package Name
- `@tanstack-ai-mastra` - Follows TanStack naming convention with Mastra suffix

### Architecture Pattern
- **Adapter Pattern**: Bridge between two incompatible interfaces
- **Strategy Pattern**: Different structured output strategies based on provider capabilities
- **Transformer Pattern**: Stream event transformation from AI SDK to TanStack format

### Key Design Decisions

1. **Model Router Integration**: Use Mastra's `ModelRouterLanguageModel` as the internal model engine
2. **Type Preservation**: Export types that preserve model-specific provider options
3. **Stream Transformation**: Async generator pattern for memory-efficient streaming
4. **Tool Call Buffering**: Accumulate partial tool call arguments during streaming
5. **Provider Capability Detection**: Runtime detection of structured output support

### Trade-offs

| Decision | Rationale |
|----------|-----------|
| Extend BaseTextAdapter | Required for TanStack AI compatibility |
| Use ModelRouterLanguageModel | Leverages Mastra's gateway system |
| Async generators for streams | Memory efficiency, backpressure support |
| Runtime capability detection | Flexibility for dynamic provider registry |

---

## Context

### TanStack AI Types
- `BaseTextAdapter<TModel, TProviderOptions, TInputModalities, TMessageMetadataByModality>`
- `StreamChunk` union type (content, tool_call, done, error, thinking)
- `TextOptions<TProviderOptions>` for chat requests
- `StructuredOutputOptions<TProviderOptions>` for structured generation

### Mastra Types
- `ModelRouterLanguageModel` - Gateway routing model
- `ModelRouterModelId` - Provider/model ID format (e.g., "openai/gpt-4o")
- `LanguageModelV2StreamPart` - AI SDK stream events
- `MastraModelGateway` - Gateway abstraction

### Conversion Mappings

| AI SDK Event | TanStack Chunk |
|--------------|----------------|
| `text-delta` | `content` |
| `tool-call` | `tool_call` |
| `finish` | `done` |
| `error` | `error` |
| `reasoning` | `thinking` |
