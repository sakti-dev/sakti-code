# Plan: @tanstack-ai-mastra Adapter Package

**Date:** 2026-01-26
**Phase:** Phase 1.3 - Protocol Bridge (Mastra → TanStack)
**Command:** /agent-os:shape-spec

---

## Overview

Create `@tanstack-ai-mastra` adapter package that bridges Mastra's `ModelRouterLanguageModel` gateway system with TanStack AI's `BaseTextAdapter` interface.

---

## Task 1: Save Spec Documentation

Create `agent-os/specs/2026-01-26-1430-tanstack-ai-mastra-adapter/` with plan.md, shape.md, standards.md, references.md

---

## Task 2: Create Package Structure

**Location:** `packages/tanstack-ai-mastra/`

**Dependencies:**
- `@mastra/core` - workspace:*
- `@tanstack/ai` - workspace:*

---

## Task 3-7: Implementation

See main plan for detailed implementation specs.

---

## Verification

1. **Type Check:** `pnpm typecheck` - Zero errors
2. **Lint:** `pnpm lint` - Zero warnings
3. **Tests:** `pnpm test`
