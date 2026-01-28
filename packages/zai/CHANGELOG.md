# @ekacode/zai Changelog

## 0.0.1

### Initial Release

First stable release of the Z.ai provider for Vercel AI SDK v3.

#### Features

- **Chat Completions** with streaming support
  - Full `LanguageModelV3` interface compliance
  - Non-streaming and streaming text generation
  - Multi-turn conversation support

- **Function Calling** (Tools)
  - Function tool definitions with Zod schemas
  - Tool choice control (auto, none, required, specific tool)
  - Multi-turn tool conversations
  - Provider tools (web_search, retrieval)

- **Tool Streaming** (`tool_stream`)
  - Real-time tool argument streaming
  - Stream tool deltas as they arrive
  - Compatible across all supported models

- **Thinking Modes**
  - `enabled` / `disabled` thinking control
  - `clear_thinking` option for preserved thinking
  - Default thinking enabled for GLM-4.7 models
  - Reasoning content in responses

- **Web Search Integration**
  - Built-in web search tool
  - Domain filtering
  - Recency filters (oneDay, oneWeek, oneMonth, oneYear, noLimit)
  - Content size control (medium, high)
  - Result sequence control (before, after)
  - Search results included as sources

- **Retrieval Tools**
  - Knowledge base integration
  - Custom prompt templates
  - Context injection for RAG workflows

- **Structured Output** (JSON Mode)
  - `responseFormat: { type: 'json' }` support
  - Maps to Z.ai `json_object` type

- **Vision/Multimodal Support**
  - Image input from URLs
  - Base64 encoded images
  - Multiple images in single request
  - Uint8Array image support
  - Supported on GLM-4.6v, GLM-4.5v models

- **Context Caching**
  - Preserved thinking support via `clear_thinking: false`
  - Cached tokens reported in usage details

#### Configuration

- **Provider Settings**
  - Endpoint selection: `general` or `coding`
  - Custom baseURL support
  - Custom headers
  - Source channel configuration
  - Custom fetch function

- **Model Support**
  - `glm-4.7` - Latest flagship with thinking enabled
  - `glm-4.7-flash` - Faster variant
  - `glm-4.7-flashx` - Enhanced flash
  - `glm-4.6` - General chat model
  - `glm-4.6v` - Vision model
  - `glm-4.5` series - Basic support
  - `autoglm-phone-multilingual` - Mobile assistant

#### Provider Options

- `thinking` - Mode configuration
- `tool_stream` - Enable tool streaming
- `web_search` - Web search configuration
- `retrieval` - Knowledge base configuration
- `request_id` - Custom request ID
- `user_id` - User identifier
- `seed` - Random seed for reproducibility
- `do_sample` - Sampling control
- `meta` - Custom metadata
- `sensitive_word_check` - Content moderation
- `watermark_enabled` - Watermarking

#### Usage Details

- Token usage reporting with input/output breakdown
- Cached tokens (prompt_tokens_details.cached_tokens)
- Reasoning tokens (completion_tokens_details.reasoning_tokens)
- Response metadata (id, modelId, timestamp)
- Finish reason mapping (stop, length, tool-calls, content-filter, error, other)
- Web search results as source content parts

#### Examples

- Basic text generation
- Streaming responses
- Multi-turn conversations
- System prompts
- Temperature and parameter control
- Tool calling (single and multiple tools)
- Tool streaming
- Tool choice control
- Multi-turn with tools
- Image analysis (URL, base64, multiple images)
- Web search with filters
- Retrieval from knowledge bases
