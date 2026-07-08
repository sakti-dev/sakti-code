## Purpose

The models.dev integration provides a generated catalog of 4147+ models across 142+ providers, converted from the models.dev API into the `Model` descriptor format. The catalog is committed to the repo and regenerated on demand. Each model includes cost rates, context window, npm provider factory binding, compatibility quirks, and thinking level mappings.

## Requirements

### Requirement: Catalog is generated from models.dev data

The system SHALL ship a committed generated catalog in `catalog/generated.ts` containing `ALL_MODELS` (flat list), `CATALOG` (grouped by provider id), `PROVIDERS` (sorted provider ids with tool-capable models), and `PROVIDER_INFO` (metadata per provider). The catalog is regenerated via a script.

#### Scenario: Flat model list is exported
- **WHEN** `ALL_MODELS` is imported
- **THEN** it contains all models across all providers

#### Scenario: Models are grouped by provider
- **WHEN** `CATALOG["anthropic"]` is accessed
- **THEN** all Anthropic models are returned

#### Scenario: Provider info is available
- **WHEN** `PROVIDER_INFO["anthropic"]` is accessed
- **THEN** metadata about the provider is returned

### Requirement: getModel looks up by provider + id

The system SHALL provide `getModel(provider, id)` that looks up a model from the catalog. Throws if not found.

#### Scenario: Look up existing model
- **WHEN** `getModel("anthropic", "claude-sonnet-4-20250514")` is called
- **THEN** the matching model descriptor is returned

#### Scenario: Look up nonexistent model throws
- **WHEN** `getModel("unknown", "nonexistent")` is called
- **THEN** an error is thrown with "Model not found"

### Requirement: Model descriptor includes @ai-sdk routing fields

Each model in the catalog SHALL include:
- `api: "ai-sdk"` — literal, all models route through @ai-sdk
- `npm` — the `@ai-sdk/*` package name (e.g. `"@ai-sdk/anthropic"`) for factory resolution
- `provider` — provider id string
- `baseUrl` — provider base URL with optional `${VAR}` placeholders
- `cost` — $/million-token rates for input, output, cacheRead, cacheWrite
- `contextWindow` — max context size in tokens
- `maxTokens` — max output tokens
- `reasoning` — boolean, whether model supports reasoning/thinking
- `status` — `"active"`, `"alpha"`, `"beta"`, or `"deprecated"`

#### Scenario: Model has all routing fields
- **WHEN** a model descriptor is inspected
- **THEN** it has `api: "ai-sdk"`, `npm`, `provider`, `baseUrl`, `cost`, `contextWindow`, `maxTokens`, `reasoning`, and `status`

### Requirement: Thinking level map is per-model

The system SHALL attach a `thinkingLevelMap` to models that support thinking, mapping each `ModelThinkingLevel` (off, minimal, low, medium, high, xhigh) to a provider-specific value string, or null if the level is unsupported by that model.

#### Scenario: Model has thinking level map
- **WHEN** a model with reasoning support is inspected
- **THEN** `thinkingLevelMap` maps each thinking level to a provider-specific value or null

### Requirement: Compat quirks are per-provider

The system SHALL attach `compat` (`OpenAICompletionsCompat`) quirks per model, encoding provider-specific reasoning formats, header requirements, and API conventions. The `thinkingFormat` is one of: `"openai"`, `"openrouter"`, `"deepseek"`, `"together"`, `"zai"`, `"qwen"`, `"qwen-chat-template"`, `"chat-template"`, `"string-thinking"`, `"ant-ling"`.

#### Scenario: Model has compat quirks
- **WHEN** a model with provider-specific quirks is inspected
- **THEN** the `compat` object contains the relevant `thinkingFormat` and other quirks

### Requirement: Catalog includes only tool-capable providers

The system SHALL include every models.dev provider with at least one tool-capable model. Providers without tool support are excluded from `PROVIDERS`.

#### Scenario: Tool-capable providers only
- **WHEN** `PROVIDERS` is inspected
- **THEN** each listed provider has at least one model with tool support
