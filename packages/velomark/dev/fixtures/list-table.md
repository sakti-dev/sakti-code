# Checklist And Summary

## Requirements

- Stable DOM identity for unchanged blocks
- Fast append-only replay
- Predictable replacement behavior for tail edits
- Clear metrics for reused and replaced blocks

## Comparison

| Mode | Reused Blocks | Replaced Blocks |
| --- | --- | --- |
| Append | High | Low |
| Rewrite Tail | Medium | Medium |
| Full Reset | Low | High |
