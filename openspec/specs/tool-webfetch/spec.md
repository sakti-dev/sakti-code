## Purpose

The webfetch tool fetches content from HTTP/HTTPS URLs and returns it as markdown (default), text, or HTML. It validates URLs, caps response size at 5MB, enforces a configurable timeout (default 30s, max 120s), rejects non-textual content types, and retries Cloudflare challenges with a fallback user agent.

## Requirements

### Requirement: WebFetch tool factory has no cwd

The system SHALL create a webfetch tool via `createWebFetchTool(options?)`. Unlike other tools, it has no `cwd` parameter — fetching is independent of the filesystem.

#### Scenario: Create webfetch tool
- **WHEN** `createWebFetchTool()` is called
- **THEN** a tool is returned that fetches any HTTP/HTTPS URL

### Requirement: WebFetch tool fetches and converts HTML

The system SHALL accept `{ url, format?, timeout? }`, fetch the URL, and convert the response. Supported formats: `"markdown"` (default, HTML→Markdown via Turndown), `"text"` (HTML tag-stripped), `"html"` (raw HTML).

#### Scenario: Fetch URL returns markdown
- **WHEN** called with `{ url: "https://example.com" }`
- **THEN** the page content is returned in markdown format

#### Scenario: Fetch with text format
- **WHEN** called with `{ url: "https://example.com", format: "text" }`
- **THEN** the page content is returned as plain text

### Requirement: WebFetch tool validates URLs

The system SHALL validate that the URL uses `http://` or `https://` protocol and is parseable.

#### Scenario: Invalid URL rejected
- **WHEN** called with a non-URL or non-HTTP/HTTPS URL
- **THEN** an error is thrown

### Requirement: WebFetch tool enforces timeout

The system SHALL enforce timeout in seconds (default 30, min 1, max 120). On timeout, the request is aborted and an error is thrown.

#### Scenario: Request times out
- **WHEN** the server does not respond within the timeout
- **THEN** an error with "timed out" is thrown

### Requirement: WebFetch tool caps response size

The system SHALL limit response body to 5MB. Content beyond the limit is truncated and the tool reports the truncation.

#### Scenario: Large response truncated
- **WHEN** the response exceeds 5MB
- **THEN** the content is truncated with a notice

### Requirement: WebFetch tool rejects non-textual content

The system SHALL check the response `Content-Type` header and reject content that is non-textual (images, binary files).

#### Scenario: Image content rejected
- **WHEN** the response is an image
- **THEN** an error is thrown with the content type

### Requirement: WebFetch tool handles Cloudflare challenges

The system SHALL detect Cloudflare challenge responses (status 403, `cf-mitigated: challenge` header) and retry with a minimal "sakti" user agent.

#### Scenario: Cloudflare challenge retry
- **WHEN** the initial request hits a Cloudflare challenge
- **THEN** the tool retries with the "sakti" user agent
