# Project Setup

## Overview

This document covers the initial project setup for ekacode, including monorepo initialization, package structure, and development infrastructure configuration.

## Repository Structure

### Final Structure

```
ekacode/
├── packages/
│   ├── desktop/          # Electron main + renderer
│   │   ├── src/
│   │   │   ├── main/     # Main process source
│   │   │   ├── preload/  # Preload scripts
│   │   │   └── renderer/ # SolidJS UI
│   │   ├── package.json
│   │   └── electron.vite.config.ts
│   ├── server/           # Hono server
│   │   ├── src/
│   │   │   ├── index.ts  # Server entry
│   │   │   └── routes/   # API routes
│   │   └── package.json
│   ├── ekacode/          # Mastra agents + tools
│   │   ├── src/
│   │   │   ├── agents/   # Agent definitions
│   │   │   ├── tools/    # Tool implementations
│   │   │   ├── security/ # Permission system
│   │   │   └── workspace/# Workspace management
│   │   └── package.json
│   └── shared/           # Shared types
│       ├── src/
│       │   └── index.ts  # Type definitions
│       └── package.json
├── docs/                 # Documentation
├── package.json          # Root package.json
├── pnpm-workspace.yaml   # pnpm workspace config
├── turbo.json           # Turborepo config
└── tsconfig.json        # Root TypeScript config
```

## Monorepo Initialization

### Package Manager Choice

**Chosen**: pnpm

**Why pnpm over npm/yarn?**

| Feature           | pnpm          | npm       | yarn        |
| ----------------- | ------------- | --------- | ----------- |
| Workspace support | ✅ Native     | ✅ Recent | ✅ Plugins  |
| Disk efficiency   | ✅ Hard links | ❌ Copies | ❌ Copies   |
| Speed             | ✅ Fastest    | ⚠️ Slow   | ✅ Fast     |
| Strict peer deps  | ✅ Default    | ❌ No     | ⚠️ Optional |

**Decision**: pnpm's hard links save disk space and improve install times.

### Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

**Why This Simple Pattern?**

- All packages under `packages/` directory
- Automatic workspace detection
- No need to list packages individually

### Root package.json

```json
{
  "name": "ekacode",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\""
  },
  "devDependencies": {
    "@types/node": "^22.19.1",
    "prettier": "^3.0.0",
    "turbo": "^2.0.0",
    "typescript": "^5.9.3"
  }
}
```

**Why Turbo for Scripts?**

- Parallel execution across packages
- Cached results for faster builds
- Dependency-aware execution order

### Turborepo Configuration

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "out/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Configuration Explained**:

- `dependsOn`: Run dependency builds first
- `outputs`: Cache based on these files
- `cache: false`: Don't cache dev server (persistent)
- `persistent`: Task runs indefinitely

## Package Creation

### Desktop Package

**Purpose**: Electron application shell

```bash
pnpm create electron-vite@latest desktop
```

**Configuration**:

```typescript
// electron.vite.config.ts
export default {
  main: {
    build: {
      rollupOptions: {
        input: {
          index: path.join(__dirname, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: path.join(__dirname, "src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: path.join(__dirname, "src/renderer/index.html"),
        },
      },
    },
  },
};
```

### Server Package

**Purpose**: Hono HTTP server

```bash
mkdir -p packages/server/src
cd packages/server
pnpm init
```

**package.json**:

```json
{
  "name": "@ekacode/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ekacode/shared": "workspace:*"
  }
}
```

### Ekacode Package

**Purpose**: Mastra agents and tools

```bash
mkdir -p packages/ekacode/src
cd packages/ekacode
pnpm init
```

**package.json**:

```json
{
  "name": "@ekacode/ekacode",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ekacode/shared": "workspace:*",
    "@ekacode/server": "workspace:*",
    "@mastra/core": "^1.0.0",
    "ai": "^3.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "zod": "^3.23.8",
    "diff": "^5.1.0",
    "glob": "^10.3.0",
    "nanoid": "^5.0.0"
  }
}
```

### Shared Package

**Purpose**: Shared TypeScript types

```bash
mkdir -p packages/shared/src
cd packages/shared
pnpm init
```

**package.json**:

```json
{
  "name": "@ekacode/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

## TypeScript Configuration

### Root tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2023"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### Package-Level tsconfig.json

Each package extends the root config:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

**Why Project References?**

- TypeScript understands package dependencies
- Faster builds (only rebuild changed packages)
- Better cross-package type checking

## Development Infrastructure

### Git Hooks

```bash
pnpm add -D husky
pnpm exec husky init
```

**Pre-commit Hook**:

```bash
# .husky/pre-commit
pnpm exec lint-staged
```

**lint-staged Config**:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

### ESLint Configuration

```json
{
  "extends": ["eslint:recommended", "typescript-eslint:recommended", "prettier"],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
```

### Prettier Configuration

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

## Build Pipeline

### Electron Builder (Future)

```json
{
  "build": {
    "appId": "com.ekacode.app",
    "productName": "ekacode",
    "directories": {
      "output": "release"
    },
    "files": ["packages/desktop/out/**/*", "packages/desktop/package.json"],
    "mac": {
      "category": "public.app-category.developer-tools"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage",
      "category": "Development"
    }
  }
}
```

### Vite Configuration

```typescript
// Optimized for Electron + TypeScript
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "chrome108", // Electron version
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["solid-js", "@tanstack-ai/react"],
        },
      },
    },
  },
});
```

## Environment Variables

### Development

```bash
# .env.development
ELECTRON_RENDERER_URL=http://localhost:5173
OPENAI_API_KEY=sk-test...
```

### Production

```bash
# .env.production (not used in built app)
# API keys stored in system keychain (keytar)
```

### Variable Access

```typescript
// Main process
const apiUrl = process.env.ELECTRON_RENDERER_URL;

// Renderer (via preload)
const env = window.ekacode.getEnv();
```

## Verification

### Test Setup

```bash
# Verify pnpm workspace
pnpm install

# Verify all packages build
pnpm build

# Verify type checking
pnpm typecheck

# Verify dev server starts
pnpm dev
```

### Expected Results

- All packages install without errors
- TypeScript compiles all packages
- Dev server starts with hot reload
- Electron window opens

## Troubleshooting

### "Cannot resolve workspace" Error

**Cause**: pnpm workspace not linked

**Fix**:

```bash
rm -rf node_modules
rm pnpm-lock.yaml
pnpm install
```

### "Cannot find module" Error

**Cause**: TypeScript project references not set up

**Fix**: Verify `references` in `tsconfig.json`

### Build Fails with "EMFILE: Too many open files"

**Cause**: File limit too low on macOS/Linux

**Fix**:

```bash
# macOS
ulimit -n 10000

# Linux (permanent)
echo "* soft nofile 10000" | sudo tee -a /etc/security/limits.conf
```

---

_Updated: 2025-01-25_
