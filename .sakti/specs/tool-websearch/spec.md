## Purpose

The websearch tool searches the web and returns a list of results (title, URL, snippet). It delegates to an injected `SearchOperations` provider (Exa, Tavily, or Zai). Defaults to 8 results (max 20) with a 25-second timeout.

## Requirements

### Requirement: WebSearch tool factory has no cwd

The system SHALL create a websearch tool via `createWebSearchTool(options?)`. The factory requires an `operations` object implementing the `SearchOperations` interface.

#### Scenario: Create websearch without provider
- **WHEN** `createWebSearchTool()` is called and no operations are configured
- **THEN** calling execute throws with a message indicating no search provider is configured

#### Scenario: Create websearch with provider
- **WHEN** `createWebSearchTool({ operations })` is called
- **THEN** the tool delegates searches to the provided operations

### Requirement: WebSearch tool returns formatted results

The system SHALL accept `{ query, numResults? }`, call the search provider, and return results formatted as numbered entries with title, URL, and snippet.

#### Scenario: Search returns results
- **WHEN** called with `{ query: "latest TypeScript news" }`
- **THEN** a numbered list of search results is returned

#### Scenario: Empty results returns notice
- **WHEN** the search provider returns zero results
- **THEN** "No search results found" is returned

### Requirement: WebSearch tool enforces limits

The system SHALL clamp `numResults` to the range [1, 20] (default 8). Results are truncated at the standard output limit with a notice.

#### Scenario: Results truncated
- **WHEN** the rendered results exceed the output size limit
- **THEN** a truncation notice is appended

### Requirement: WebSearch tool enforces timeout

The system SHALL apply a 25-second timeout to all searches. On timeout, an error is thrown.

#### Scenario: Search times out
- **WHEN** the provider does not respond within 25 seconds
- **THEN** an error with "timed out" is thrown

### Requirement: WebSearch tool validates query

The system SHALL require a non-empty query string.

#### Scenario: Empty query rejected
- **WHEN** called with an empty or whitespace-only query
- **THEN** an error is thrown
