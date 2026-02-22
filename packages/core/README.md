# @sakti-code/core

Core package for Sakti Code AI agent system.

## Testing

This package follows a hybrid test architecture with colocation for unit tests and centralized integration suites. See [`tests/TESTING_ARCHITECTURE.md`](./tests/TESTING_ARCHITECTURE.md) for detailed documentation on test placement, import patterns, and verification commands.

### Quick Start

```bash
# Run all tests
pnpm test

# Type check tests
pnpm test:typecheck

# Run only unit tests
pnpm test:unit

# Run integration tests (requires RUN_ONLINE_TESTS=1)
pnpm test:integration

# Lint
pnpm lint
```

## Development

### Adding New Tests

1. **Pure unit tests** (no external dependencies): Add to `src/<domain>/__tests__/`
2. **Integration tests** (multi-component, DB/API): Add to `tests/integration/`
3. **DB-dependent tests**: Keep in `tests/<domain>/` to avoid typecheck issues

See [`tests/TESTING_ARCHITECTURE.md`](./tests/TESTING_ARCHITECTURE.md) for detailed guidance.

### Import Patterns

- In unit tests: Use `@/<domain>/...` for core internals
- In integration tests: Use `@/*` for core internals
- Avoid: Direct imports from `@sakti-code/server` (use core server-bridge contracts)

## Architecture

The core package contains:

- **Agent**: AI agent implementation with tool usage
- **Session**: Session management for agent conversations
- **Tools**: Tool registry and implementations (read, write, bash, search-docs, etc.)
- **Instance**: Workspace context management
- **LSP**: Language Server Protocol integration
- **Spec**: Specification compiler for agent plans
- **Skill**: Skill system for custom agent behaviors
- **Memory**: Memory system (observations, reflections, working memory)
- **Workspace**: Workspace management
- **Config**: Configuration handling
- **Chat**: Chat command processing
- **Plugin**: Plugin system

## Notes

- DB-dependent tests remain in `tests/<domain>/` to avoid `test:typecheck` cross-package import issues
- ESLint rules enforce import patterns to prevent regressions
- Migration from legacy domain-based structure completed 2026-02-23
