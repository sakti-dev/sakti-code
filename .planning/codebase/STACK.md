# Technology Stack

**Analysis Date:** 2026-02-22

## Languages

**Primary:**

- TypeScript 5.9.3 - All application code (core, server, desktop, shared)

**Secondary:**

- JavaScript - Build configuration and tooling (eslint.config.js, turbo.json)

## Runtime

**Environment:**

- Node.js 20.x+ (required by pnpm 10.x)
- Browser runtime (for desktop app)

**Package Manager:**

- pnpm 10.28.0
- Lockfile: `pnpm-lock.yaml` present

## Frameworks

**Core:**

- @mastra/core 1.0.4 - AI agent framework
- Vercel AI SDK (ai) 6.0.58 - AI model abstraction layer
- Hono 4.11.7 - HTTP framework for server
- SolidJS 1.9.0 - UI framework for desktop app

**Testing:**

- Vitest 4.0.18 - Unit and integration tests
- @vitest/coverage-v8 - Code coverage

**Build/Dev:**

- Vite 7.2.6 - Build tool and dev server
- Turbo 2.8.0 - Monorepo build orchestration
- TypeScript 5.9.3 - Compilation

## Key Dependencies

**AI & Language Models:**

- ai 6.0.58 - Vercel AI SDK
- @ai-sdk/\* - Multiple AI provider adapters (OpenAI, Anthropic, Google, Azure, Amazon Bedrock, Cohere, Groq, Mistral, etc.)
- @ekacode/zai - Custom AI abstractions

**Server & Database:**

- Hono 4.11.7 - Web framework
- drizzle-orm 0.45.1 - SQL ORM
- @libsql/client 0.17.0 - LibSQL/Turso database client

**Desktop App:**

- Electron 39.2.6 - Desktop runtime
- SolidJS 1.9.0 - UI framework
- @solidjs/router 0.15.1 - Routing

**Utilities:**

- Zod 4.3.6 - Schema validation
- Pino 9.14.0 - Logging
- simple-git 3.31.1 - Git operations
- uuid 13.0.0 - UUID generation
- xstate 5.18.0 - State machines

## Configuration

**Environment:**

- `.env` file for local development
- Environment variables via `dotenv`
- Key configs: DATABASE_URL, API keys for AI providers

**Build:**

- `tsconfig.json` - TypeScript config (project references)
- `turbo.json` - Turborepo configuration
- `vitest.config.ts` - Test runner config (per package)
- `eslint.config.js` - ESLint configuration

**Catalog:**

- `pnpm-workspace.yaml` defines version catalog for shared dependencies

## Platform Requirements

**Development:**

- Node.js 20.x+
- pnpm 10.x
- Git

**Production:**

- Desktop: Electron (bundled)
- Server: Node.js runtime with Hono
- Database: LibSQL (local file or remote)

---

_Stack analysis: 2026-02-22_
