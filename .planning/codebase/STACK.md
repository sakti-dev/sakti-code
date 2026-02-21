# Technology Stack

**Analysis Date:** 2026-02-22

## Languages

**Primary:**

- TypeScript 5.9.3 - All packages and apps

**Secondary:**

- CSS/Tailwind - Frontend styling in `apps/desktop`

## Runtime

**Environment:**

- Node.js 22.x (from @types/node ^22.19.7)
- pnpm 10.28.0 (package manager with workspaces)

**Package Manager:**

- pnpm 10.28.0
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core:**

- Hono 4.11.7 - HTTP server framework in `@ekacode/server`
- Solid.js 1.9.x - UI framework in `apps/desktop`
- Mastra 1.0.4 - AI agent framework
- XState 5.18.0 - State management

**Testing:**

- Vitest 4.0.18 - Test runner across all packages
- @vitest/coverage-v8 - Coverage reporting

**Build/Dev:**

- Vite 7.2.6 - Build tool for desktop app
- Turbo 2.8.0 - Monorepo build orchestration
- Drizzle Kit 0.31.x - Database migrations

## Key Dependencies

**AI & LLM:**

- ai 6.0.58 - AI SDK for streaming responses
- @ai-sdk/\* - Multiple provider adapters:
  - @ai-sdk/openai - OpenAI models
  - @ai-sdk/anthropic - Anthropic Claude
  - @ai-sdk/google - Google Gemini
  - @ai-sdk/azure - Azure OpenAI
  - @ai-sdk/amazon-bedrock - AWS Bedrock
  - @ai-sdk/perplexity - Perplexity
  - @ai-sdk/xai - xAI Grok
  - @openrouter/ai-sdk-provider - OpenRouter
  - @gitlab/gitlab-ai-provider - GitLab AI

**Database:**

- drizzle-orm 0.45.x - ORM for SQLite
- better-sqlite3 12.6.x - SQLite driver (libSQL compatible)
- @libsql/client 0.17.x - libSQL client

**Frontend:**

- @solidjs/router 0.15.x - Routing
- @kobalte/core 0.13.x - Solid.js component library
- tailwindcss 4.1.x - CSS framework
- lucide-solid 0.575.x - Icons
- marked 15.x - Markdown parsing
- shiki 1.24.x - Syntax highlighting
- dompurify 3.3.x - HTML sanitization
- morphdom 2.7.x - DOM diffing

**Desktop:**

- Electron 39.2.6 - Desktop application framework

**Utilities:**

- pino 9.14.x - Logging
- zod 4.3.x - Schema validation
- uuid 13.0.x - ID generation
- chokidar 5.0.x - File watching
- unstorage 1.17.x - Storage abstraction
- minisearch 7.2.x - Full-text search
- simple-git 3.31.x - Git operations

## Configuration

**Environment:**

- `.env` file with ZAI_API_KEY
- pnpm workspaces defined in `pnpm-workspace.yaml`
- Catalogs for version management in pnpm-workspace.yaml

**Build:**

- TypeScript paths defined in `tsconfig.json`
- Turbo pipeline in `turbo.json`
- Vite configs in each app

## Platform Requirements

**Development:**

- Node.js 22.x
- pnpm 10.28.0
- Git (for VCS operations)

**Production:**

- Electron for desktop app
- SQLite (libSQL) for data persistence

---

_Stack analysis: 2026-02-22_
