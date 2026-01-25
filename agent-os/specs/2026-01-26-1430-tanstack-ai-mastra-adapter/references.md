# References: @tanstack-ai-mastra Adapter

**Date:** 2026-01-26

---

## Reference Implementations Studied

### TanStack AI Reference Files

1. **`tanstack-ai/packages/typescript/ai/src/activities/chat/adapter.ts`**
   - Defines `BaseTextAdapter` abstract class
   - `chatStream()` method signature
   - `structuredOutput()` method signature
   - `TextAdapterConfig` interface
   - `StructuredOutputOptions` interface

2. **`tanstack-ai/packages/typescript/ai/src/types.ts`**
   - `StreamChunk` union type
   - `ModelMessage` interface
   - `Tool` interface with Standard JSON Schema support
   - `TextOptions` interface
   - ContentPart types for multimodal support

3. **`tanstack-ai/packages/typescript/ai-openai/src/adapters/text.ts`**
   - Reference implementation for OpenAI adapter
   - Stream chunk processing patterns
   - Tool call metadata tracking
   - Structured output with JSON schema

### Mastra Reference Files

1. **`mastra/packages/core/src/llm/model/router.ts`**
   - `ModelRouterLanguageModel` class
   - `doStream()` method returning `StreamResult`
   - Gateway resolution logic
   - API key handling

2. **`mastra/packages/core/src/llm/model/gateways/base.ts`**
   - `MastraModelGateway` abstract class
   - `GatewayLanguageModel` type (V2 | V3)
   - `resolveLanguageModel()` method

3. **`mastra/packages/core/src/llm/model/provider-registry.ts`**
   - `ModelRouterModelId` type
   - `parseModelString()` function
   - `PROVIDER_REGISTRY` proxy

---

## Key Integration Points

1. **Stream Format Conversion**
   - AI SDK `LanguageModelV2StreamPart` → TanStack `StreamChunk`
   - Tool call delta buffering
   - Usage metadata mapping

2. **Message Format Conversion**
   - TanStack `ModelMessage` → AI SDK `CoreMessage`
   - Multimodal content handling
   - Tool result formatting

3. **Tool Definition Conversion**
   - TanStack `Tool` → AI SDK `Tool[]`
   - Zod schema → JSON Schema conversion

4. **Structured Output**
   - Provider capability detection
   - Strategy selection (native/tool-based/instruction)
