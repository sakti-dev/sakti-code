## Purpose

The LLM provider layer resolves a `Model` descriptor from the catalog into an @ai-sdk `LanguageModelV4` ready for `streamText`. It routes every provider through `@ai-sdk/*` factories driven by the model's `npm` field — zero hand-written per-provider API code. SDK instances are cached per `npm + options` pair.

## Requirements

### Requirement: Provider factory registry maps npm to loaders

The system SHALL maintain `BUNDLED_PROVIDERS`, a `Record<string, ProviderFactoryLoader>` mapping npm package names to lazy factory-loading thunks. Each thunk dynamic-imports its `@ai-sdk/*` package on first call and returns the `create*` factory function.

#### Scenario: Bundled providers load on first use
- **WHEN** a factory loader for `"@ai-sdk/anthropic"` is called
- **THEN** it dynamic-imports the package and returns the `createAnthropic` factory

#### Scenario: Unknown npm falls back to dynamic import
- **WHEN** a model's npm is not in `BUNDLED_PROVIDERS`
- **THEN** the package is loaded via dynamic `import(npm)` and the first `create*` export is used as the factory

### Requirement: resolveLanguageModel turns a Model into LanguageModelV4

The system SHALL provide `resolveLanguageModel(model, options)` that resolves a model descriptor to an @ai-sdk `LanguageModelV4`. It builds factory options from the model + caller options, loads the factory, creates the SDK, and calls `sdk.languageModel(model.id)`.

#### Scenario: Resolve with API key and base URL
- **WHEN** `resolveLanguageModel(model, { apiKey: "sk-...", baseURL: "https://custom.com/v1" })` is called
- **THEN** the SDK is created with the given key and base URL

#### Scenario: Error when model has no npm
- **WHEN** `resolveLanguageModel(model)` is called with a model that has no npm
- **THEN** an error is thrown indicating the catalog must set `Model.npm`

### Requirement: Base URL supports env variable substitution

The system SHALL resolve `${VAR}` placeholders in `model.baseUrl` from the environment map. Unresolved placeholders are left as-is. An empty or whitespace-only base URL returns `undefined` (signals "use factory default").

#### Scenario: Substitute ${ACCOUNT_ID} from env
- **WHEN** `model.baseUrl` is `"https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"` and env has `CLOUDFLARE_ACCOUNT_ID`
- **THEN** the placeholder is replaced with the env value

#### Scenario: Unresolved placeholder kept as-is
- **WHEN** env map has no value for `${VAR}`
- **THEN** the placeholder is left unchanged in the URL

### Requirement: SDK instances are cached

The system SHALL cache `ProviderSDK` instances keyed by `JSON.stringify({ npm, opts })`. The cache is process-lifetime. `clearResolveCache()` is exported for tests.

#### Scenario: Repeated resolution returns cached SDK
- **WHEN** `resolveLanguageModel` is called twice with the same npm and options
- **THEN** the second call uses the cached SDK instance

#### Scenario: Test isolation clears cache
- **WHEN** `clearResolveCache()` is called
- **THEN** the SDK cache is emptied

### Requirement: LanguageModelV3 is wrapped to V4

The system SHALL wrap `LanguageModelV3` instances to `LanguageModelV4` using `wrapLanguageModel` with empty middleware when the provider returns a V3 model.

#### Scenario: V3 model wrapped to V4
- **WHEN** a provider returns a `LanguageModelV3`
- **THEN` it is wrapped to `LanguageModelV4` by `wrapLanguageModel`

### Requirement: Headers are merged with model headers winning

The system SHALL merge caller-supplied headers with model's static headers, with model headers winning on conflict.

#### Scenario: Merge request and model headers
- **WHEN** caller passes `{ "x-request-id": "abc" }` and model has `{ "x-api-key": "def" }`
- **THEN** both headers are present, with model headers overriding on conflict

### Requirement: Generic openai-compatible factory enables usage reporting

The system SHALL force-enable `includeUsage: true` when the model uses `@ai-sdk/openai-compatible`, ensuring cost tracking works for the ~100 catalog providers routed through the generic factory.

#### Scenario: includeUsage set for openai-compatible
- **WHEN** `model.npm` is `"@ai-sdk/openai-compatible"`
- **THEN** `includeUsage: true` is included in the factory options

### Requirement: Factory is injectable for testing

The system SHALL accept a custom `factoryMap` parameter in `resolveLanguageModel` for test injection, bypassing both the real registry and the SDK cache.

#### Scenario: Test factory overrides resolution
- **WHEN** `resolveLanguageModel(model, opts, fakeRegistry)` is called
- **THEN** the fake registry's factory is used and the SDK cache is skipped
