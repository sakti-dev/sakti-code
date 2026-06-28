# Long Mixed Response

Velomark should feel good on realistic coding-agent output, not just tiny markdown samples.

> Earlier explanation blocks should remain stable while the answer continues to grow.

## Implementation Direction

1. Build a render document from the latest markdown snapshot.
2. Reuse unchanged prefix blocks with stable IDs.
3. Replace only the changed suffix when the tail is rewritten.

### Example

A renderer viewport should support paragraphs, lists, code blocks, and tables in one long transcript.

```ts
const metrics = {
  reusedBlockCount: 8,
  replacedBlockCount: 1,
  appendedBlockCount: 2,
};
```

| Metric | Meaning |
| --- | --- |
| `reusedBlockCount` | Earlier blocks preserved |
| `replacedBlockCount` | Blocks that lost identity |
| `appendedBlockCount` | New blocks added at the tail |

Final note: this sample is intentionally long enough to make replay and selection feel meaningful in the playground.
