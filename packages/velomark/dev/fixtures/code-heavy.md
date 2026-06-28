# Streamed Patch Example

The renderer should preserve earlier blocks while later code arrives.

```ts
export function appendChunk(previous: string, chunk: string): string {
  return previous + chunk;
}
```

## Notes

- Code fences should remain readable during replay.
- Inline `code` should keep simple semantics.
- Tail rewrites should only replace the affected suffix.
