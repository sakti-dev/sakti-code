# Standards: @tanstack-ai-mastra Adapter

**Date:** 2026-01-26

---

## Applied Standards

### Code Quality Standards
- Zero TypeScript errors before committing
- Zero ESLint warnings
- No `any` types without justification
- Meaningful names (pronounceable, searchable)
- Small, focused functions (single responsibility)
- Explicit over implicit (named constants)
- Early returns and guard clauses
- Specific error handling

### Tech Stack Standards
- Mastra Framework for model routing
- TanStack AI for streaming interface
- Node.js (not Bun)
- TypeScript strict mode
- Zod for validation

---

## Implementation Patterns

### File Organization
```
src/
├── index.ts              # Public exports
├── adapters/
│   └── text.ts           # Main adapter implementation
├── types.ts              # Type definitions
├── stream.ts             # Stream transformation
├── convert.ts            # Message/tool conversion
├── structured-output.ts  # Structured output strategies
└── utils.ts              # Helper functions
```

### Naming Conventions
- `convert*` - Conversion functions between formats
- `map*` - Mapping one value to another
- `transform*` - Complex transformations
- `detect*` - Capability detection
- `*Accumulator` - Stateful buffering classes

### Error Handling
- Always yield `error` chunks for stream errors
- Include error context (message, code)
- Never throw from async generators
- Log warnings for degraded functionality
