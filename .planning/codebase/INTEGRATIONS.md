# External Integrations

**Analysis Date:** 2026-02-22

## APIs & External Services

**AI Providers:**

- OpenAI - Primary LLM provider
  - SDK: @ai-sdk/openai
  - Auth: OPENAI_API_KEY env var
- Anthropic (Claude) - Alternative LLM
  - SDK: @ai-sdk/anthropic
  - Auth: ANTHROPIC_API_KEY env var
- Google AI (Gemini) - Alternative LLM
  - SDK: @ai-sdk/google, @ai-sdk/google-vertex
  - Auth: GOOGLE_GENERATIVE_AI_API_KEY env var
- Azure OpenAI - Enterprise LLM
  - SDK: @ai-sdk/azure
  - Auth: AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT
- Amazon Bedrock - AWS-hosted models
  - SDK: @ai-sdk/amazon-bedrock
  - Auth: AWS credentials
- Cohere, Groq, Mistral, Perplexity, TogetherAI, XAI, Cerebras, DeepInfra, Vercel - Additional providers
  - SDK: @ai-sdk/\* packages
  - Auth: Provider-specific API keys

## Data Storage

**Database:**

- LibSQL (Turso)
  - Connection: DATABASE_URL env var
  - Client: @libsql/client
  - ORM: drizzle-orm
  - Migrations: drizzle-kit

**File Storage:**

- Local filesystem (for desktop app data, logs)
- Unstorage 1.17.3 - For server-side file abstraction

**Caching:**

- In-memory caching via unstorage
- Minisearch 7.2.0 - In-memory full-text search

## Authentication & Identity

**Auth:**

- Custom implementation using AI SDK
- API keys for AI providers via environment variables

## Monitoring & Observability

**Error Tracking:**

- Not configured (potential improvement)

**Logs:**

- Pino 9.14.0 - Structured JSON logging
- pino-pretty 11.3.0 - Human-readable formatting for dev
- Console logging for desktop app

## CI/CD & Deployment

**Hosting:**

- Not configured (desktop-first, local server)

**CI Pipeline:**

- GitHub Actions (see `.github/`)
- Husky for pre-commit hooks
- lint-staged for staged file linting

## Environment Configuration

**Required env vars:**

- DATABASE_URL - LibSQL database connection
- OPENAI_API_KEY - OpenAI API access
- ANTHROPIC_API_KEY - Anthropic API access
- Other AI provider keys as needed

**Secrets location:**

- `.env` file (gitignored)
- Environment variables at runtime

## Webhooks & Callbacks

**Incoming:**

- None currently configured

**Outgoing:**

- None currently configured

---

_Integration audit: 2026-02-22_
