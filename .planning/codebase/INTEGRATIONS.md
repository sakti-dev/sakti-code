# External Integrations

**Analysis Date:** 2026-02-22

## APIs & External Services

**LLM Providers:**

- OpenAI - ChatGPT models via @ai-sdk/openai
  - Auth: OPENAI_API_KEY (env var)
- Anthropic - Claude models via @ai-sdk/anthropic
  - Auth: ANTHROPIC_API_KEY (env var)
- Google - Gemini models via @ai-sdk/google / @ai-sdk/google-vertex
  - Auth: GOOGLE_API_KEY / GOOGLE_VERTEX_PROJECT
- Azure OpenAI - via @ai-sdk/azure
  - Auth: AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT
- AWS Bedrock - via @ai-sdk/amazon-bedrock
  - Auth: AWS credentials
- Perplexity - via @ai-sdk/perplexity
  - Auth: PERPLEXITY_API_KEY
- xAI - Grok models via @ai-sdk/xai
  - Auth: XAI_API_KEY
- OpenRouter - via @openrouter/ai-sdk-provider
  - Auth: OPENROUTER_API_KEY
- GitLab AI - via @gitlab/gitlab-ai-provider
  - Auth: GITLAB_TOKEN
- Cerebras, Cohere, DeepInfra, Gateway, Mistral, Vercel - via respective SDKs

**ZAI (Custom):**

- ZAI - Proprietary AI provider
  - SDK: @ekacode/zai (local package)
  - Auth: ZAI_API_KEY (in .env)

## Data Storage

**Databases:**

- SQLite (libSQL)
  - Connection: Local file via better-sqlite3
  - Client: drizzle-orm
  - Location: `packages/server/db/`

**File Storage:**

- Local filesystem for workspace data
- SQLite for structured data

**Caching:**

- In-memory cache via unstorage in server

## Authentication & Identity

**Auth Provider:**

- Custom Basic Auth
  - Implementation: Username/password via EKACODE_USERNAME/EKACODE_PASSWORD env vars
  - Session management via UUID tokens
  - File: `packages/server/src/middleware/auth.ts`

## Monitoring & Observability

**Error Tracking:**

- Not detected (no Sentry/Bugsnag integration)

**Logs:**

- Pino logger with file output
- Log location: `logs/server-dev.log` (development)
- File: `packages/shared/src/logger/index.ts`

## CI/CD & Deployment

**Hosting:**

- Electron for desktop app packaging

**CI Pipeline:**

- GitHub Actions in `.github/`
- Git hooks via husky

## Environment Configuration

**Required env vars:**

- ZAI_API_KEY - ZAI provider key
- OPENAI_API_KEY - OpenAI (optional)
- ANTHROPIC_API_KEY - Anthropic (optional)
- EKACODE_USERNAME - Server auth username
- EKASERVER_PASSWORD - Server auth password
- PORT - Server port (optional, defaults to random)

**Secrets location:**

- `.env` file in project root (not committed to git)

## Webhooks & Callbacks

**Incoming:**

- None detected (local-only application)

**Outgoing:**

- SSE (Server-Sent Events) for real-time chat updates
- File: `packages/server/src/routes/event.ts`

---

_Integration audit: 2026-02-22_
