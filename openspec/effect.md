Here's the dependency-ordered ranking, easiest first:
Tier 1: Zero dependencies (pure standalone)
1. prompts/intake-system-prompt.ts — just a string constant
2. lib/truncate.ts — pure buffer-truncation utilities, no deps
3. utils/event-stream.ts — standalone async event emitter, no deps
Tier 2: Node stdlib only
4. harness/config-entry-name.ts — node:path/posix, 20 lines
5. harness/permission.ts — node:os (homedir), pure matching fns
6. harness/prompt-preprocessor.ts — node:path, pure parsing fns
Tier 3: Workspace deps, no internal deps
7. harness/build-stream-request.ts — @sakti-code/llm + @sakti-code/logger
8. harness/messages.ts — src/types.ts + @sakti-code/llm
9. utils/validation.ts — @sakti-code/llm + typebox, small
Tier 4: Internal type-only deps
10. compaction/utils.ts — src/types.ts + @sakti-code/llm, pure fns
11. harness/system-prompt.ts — harness/types.ts only
12. harness/memory-storage.ts — harness/types.ts + uuid, isolated
13. types.ts — the foundation (type-level only, more copy than port)
Tier 5+: Complex (many transitive deps)
14. harness/loader-shared.ts → 15. commands.ts / agents.ts / prompt-templates.ts / skills.ts
15. harness/session.ts → 17. harness/types.ts → 18. builtin-agents.ts
16. compaction.ts → 20. auto-compaction.ts → 21. branch-summarization.ts
17. loop/agent-loop.ts → 23. retry-loop.ts → 24. agent.ts → 25. harness/agent-harness.ts
The types.ts is a special case — it needs to be re-exported first since everything depends on it, but it's all type imports from @sakti-code/llm + typebox, so there's nothing Effect-specific to port there. We'd just copy it over.
Want to start with Tier 1 and work our way down? I'd suggest beginning with lib/truncate.ts to demonstrate the Effect pattern (pure function is the simplest conversion).