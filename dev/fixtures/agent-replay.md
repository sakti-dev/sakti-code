# Agent Replay Stress Sample

This preset is intentionally long and shaped like a coding-agent response so replay, selection, and hover behavior stay visible for more than a few frames.

## Session Summary

The assistant explored a monorepo workspace, inspected task-session workflow files, compared prompt strategies, and then migrated the markdown renderer away from Incremark toward a purpose-built Solid-only renderer package named `velomark`.

## Why This Preset Exists

- The playground needs a stress sample closer to real coding-agent output.
- Short markdown examples complete too quickly and hide update costs.
- Long prefix stability is what exposes selection-loss bugs.
- Mixed content reveals whether only the suffix is replaced during rewrites.

## Observed Workflow

1. Research the repository structure and active specs.
2. Review prompt architecture and tool selection behavior.
3. Investigate doom-loop detection and repeated file reads.
4. Redesign read batching, workflow actions, and task-session resume state.
5. Build a custom streaming renderer with stable block identity.
6. Validate the packaged library from a clean consumer path.

## Long-Form Architectural Notes

The coding-agent workflow favors append-heavy updates. The first blocks of an answer often contain problem framing, tradeoffs, and explicit findings. Those blocks should remain stable while later sections such as implementation details, verification steps, and follow-up actions continue to stream in.

That means the renderer needs to preserve DOM identity for earlier blocks rather than remounting the entire markdown tree. If a user is hovering a file reference or selecting text in the first section of a reply, later paragraph and code-fence updates should not destroy that interaction state.

In practice, the render document should treat a long answer as a sequence of stable blocks. When the answer grows by appending a new paragraph or a new code fence, the renderer should attach only the new suffix blocks. When the answer changes near the tail, only the changed suffix should be replaced. Prefix reuse is the central performance invariant.

## Example Findings

### Prompting

- Tool descriptions should be procedural for weaker models.
- Primary workflow actions must be server-owned.
- The model may suggest secondary actions, but it should not invent mandatory next steps.
- Review gates should remain explicit even when the UX is simplified into friendlier checkpoints.

### Workflow State

- Task sessions need durable runtime mode persistence.
- Resume should come from canonical workflow state, not blind chat reconstruction.
- A reopened task session should restore checkpoint summaries and next actions through the server.
- Intake sessions do not need the same persistence model because they are intentionally disposable scratch space.

### Rendering

- Append-first streaming is the hot path.
- Reasoning should stream as deltas too if the upstream protocol already emits deltas.
- Snapshot reconstruction belongs in state, not on the wire.
- Renderer components should update only the blocks that actually changed.

## Example Code

```ts
interface WorkflowSnapshot {
  currentStage: "research" | "scope" | "technical-plan" | "work-plan" | "build";
  primaryActions: string[];
  secondaryActions: string[];
  handoffSummary: string;
}

function resumeFromSnapshot(snapshot: WorkflowSnapshot): string {
  return [
    `Current stage: ${snapshot.currentStage}`,
    `Primary actions: ${snapshot.primaryActions.join(", ")}`,
    `Secondary actions: ${snapshot.secondaryActions.join(", ")}`,
    snapshot.handoffSummary,
  ].join("\n");
}
```

## Comparative Table

| Concern | Naive Snapshot Renderer | Stable Block Renderer |
| --- | --- | --- |
| Early block hover | Often lost | Preserved |
| Text selection | Often reset | Preserved on append |
| Tail rewrite cost | Full subtree churn | Suffix-only replacement |
| Streaming feel | Janky under long output | Predictable and incremental |
| Packaged consumer compatibility | Toolchain-dependent | Explicitly validated |

## Extended Discussion

A realistic coding-agent answer rarely stops after two short paragraphs. It keeps growing through findings, tradeoffs, file references, code snippets, and verification output. The stress preset should reflect that actual rhythm instead of a minimal markdown demo because renderer defects only become obvious when the transcript is long enough to scroll, select, and revisit.

The most important behavioral checks are not abstract microbenchmarks. They are user-facing interaction guarantees:

- Can the user select text in the first block and keep that selection while the answer grows?
- Can the user hover a link or code span without the element being remounted away?
- Can the renderer append late code fences without disturbing earlier headings and lists?
- Can the system report block reuse clearly enough that regressions are easy to spot?

## More Structured Content

> Stable prefix blocks are the entire point. If the renderer cannot preserve them, the rest of the optimization story is weak.

### Checklist

- Preserve stable block IDs across append-only updates.
- Preserve DOM nodes for unchanged prefix blocks.
- Replace only the rewritten suffix on tail edits.
- Stream both answer text and reasoning as deltas.
- Validate the package from a clean consumer install path.
- Keep the playground large enough to make regressions obvious.

### Additional Table

| Metric | Append Path | Rewrite Tail |
| --- | --- | --- |
| Reused Blocks | High | Medium |
| Replaced Blocks | Low | Medium |
| Appended Blocks | High | Low |
| Selection Stability | Strong | Depends on rewrite location |

## Final Notes

This preset deliberately exceeds the size of the old toy samples. It is not trying to be elegant. It is trying to expose the real renderer behavior that matters for streamed AI responses in the desktop app.

Use this preset first when evaluating:

1. selection stability
2. hover retention
3. append smoothness
4. rewrite-tail behavior
5. benchmark panel usefulness
