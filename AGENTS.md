# AGENTS.md

Guidance for AI coding agents working in this repository.

## Debugging: bisect before you theorize

When a problem has produced confident explanations that don't quite fit the evidence, **stop theorizing and bisect to a minimal reproduction.** Plausible-sounding root-cause narratives — especially those built from post-hoc memory/GC/runtime jargon — are cheap to generate and hard to verify. A single falsifying experiment is worth more than a paragraph of mechanism.

A real example from this codebase: the agent-loop tests "OOM'd" under vitest. Two research-agent round-trips produced elaborate memory theories (`vi.importActual` re-imports, spy-history pinning, `vite-node` async-continuation frames). All were wrong. The actual cause was a **missing 2-line check** — `loop.ts` never honored `AgentToolResult.terminate`, so one test (`tool with terminate=true`, using a reusable `mockReturnValue` stream) spun forever, slowly filling the heap until the worker died. It *looked* like a memory leak; it was an infinite loop.

The techniques that actually found it, in order of value:

1. **`node --trace-gc`** on the failing run — showed the worker heap climbing to 4 GB with "Ineffective mark-compacts" (genuine retention, not GC thrash). Immediately ruled out the "thrashing under memory pressure" theory.
2. **Bisection by test count** — 1 multi-turn test = 25 MB pass; 2 tests = 4 GB OOM. A *binary* trigger, not gradual accumulation. This alone ruled out every linear-retention theory (spy history, message arrays, module re-imports).
3. **Progressive minimal repros** — rebuild the failing scenario from scratch, dropping one layer at a time (mock only → mock + nested async generators → mock + real `createAgentLoop` → mock + real loop + `collectEvents` + assertions). Each passed. That narrowed the culprit to a *difference between the repro and the real test*, which forced a careful re-read of the failing test body.
4. **Re-read the test against the source** — the test used `mockReturnValue` (reusable stream) + a `terminate:true` tool, and `loop.ts` had no `terminate` branch. Spotted in seconds once everything else was exonerated.

**Heuristics to internalize:**

- "OOM" that appears at the *second* invocation in a worker is almost always an infinite loop or unbounded growth in one specific path, not ambient leakage. Find the path first.
- An 8 GB heap that *hangs* (instead of crashing faster) is the signature of a slow infinite loop, not a leak — a real leak would OOM sooner with more memory.
- If a research agent's explanation can't be turned into a falsifying experiment, treat it as a hypothesis to test, not an answer. Verify the one concrete claim it makes against the actual source before acting on any of its recommendations.
- A failing test that hangs is data. Run it **alone** with a hard `timeout` and check the exit code (`124` = killed = hang). This was the single decisive experiment.
