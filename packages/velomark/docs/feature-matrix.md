# Velomark Feature Matrix

This matrix describes the current tested renderer surface.

## Legend

- `Supported`: intended public behavior, covered by tests
- `Partial`: works for the current supported subset but is intentionally narrower than a full general-purpose markdown engine
- `Out of scope`: intentionally not part of the current package goals

## Block syntax

| Feature | Status | Notes |
| --- | --- | --- |
| Paragraphs | Supported | Semantic `<p>` output |
| Headings | Supported | Semantic heading tags |
| Blockquotes | Supported | Preserves paragraph structure |
| Ordered / unordered lists | Supported | Includes nested child lists |
| Task lists | Supported | Disabled checkbox output |
| Fenced code blocks | Supported | Generic shell with built-in defaults and syntax highlighting |
| Mermaid fences | Supported | Built-in diagram preview with automatic source fallback |
| Tables | Supported | Includes column alignment support |
| Thematic breaks | Supported | Semantic `<hr>` |
| Footnote definitions | Supported | Document footnote section rendered |
| Block math | Supported | KaTeX render with safe fallback for invalid or incomplete formulas |
| Raw block HTML | Supported | Safe source-shell rendering |
| Structured HTML block elements | Supported | Parsed for simple supported elements |
| Container directives | Supported | Generic container rendering |
| Leaf directives | Supported | Generic standalone directive rendering |

## Inline syntax

| Feature | Status | Notes |
| --- | --- | --- |
| Text | Supported | |
| Strong / emphasis / delete | Supported | `**`, `__`, `*`, `_`, `~~` |
| Inline code | Supported | |
| Hard line breaks | Supported | Two-space and backslash forms |
| Links | Supported | External links render with safe attributes |
| Images | Supported | Lazy-loaded `<img>` |
| Reference-style links/images | Supported | Explicit, collapsed, and shortcut forms |
| Footnote references | Supported | Superscript backlink references |
| Inline math | Supported | KaTeX render with safe fallback for invalid or incomplete formulas |
| Raw inline HTML | Supported | Direct inline HTML rendering |
| Structured inline HTML elements | Supported | Parsed for simple supported elements |
| Text directives | Supported | Generic inline directive rendering |

## Streaming behavior

| Behavior | Status | Notes |
| --- | --- | --- |
| Append-heavy streaming | Supported | Primary optimization target |
| Stable prefix DOM identity | Supported | Core renderer behavior |
| Rewrite-tail streaming | Supported | Used in the playground and regression coverage |
| Stable streamed code-block shell | Supported | Highlighted code blocks preserve outer shell identity on growth |
| Incomplete streamed fences | Supported | Covered by streaming corpus |
| Late-arriving reference definitions | Supported | Covered by streaming corpus |
| Incomplete directives | Supported | Covered by streaming corpus |
| Incomplete HTML | Supported | Covered by streaming corpus |
| Incomplete tables | Supported | Covered by streaming corpus |
| Render-surface parity corpus | Supported | `test/fixtures/parity` + semantic regression harness |

## Public API surface

| Surface | Status | Notes |
| --- | --- | --- |
| `Velomark` component | Supported | Primary entrypoint |
| `theme` prop | Supported | `default`, `dark`, or partial semantic token overrides |
| Theme presets and utilities | Supported | `defaultTheme`, `darkTheme`, `mergeTheme`, `generateCssVars`, `applyTheme` |
| `codeBlockOptions` | Supported | Small default-UX config surface |
| `codeBlockRenderers` | Supported | Language override map |
| `containers` | Supported | Container/directive override map |
| `onDebugMetrics` | Supported | Diagnostics hook |
| Broad global component-map API | Out of scope | Avoided intentionally for now |
| Framework-agnostic core package | Out of scope | `velomark` is Solid-only |

## Current partial areas

| Feature | Status | Notes |
| --- | --- | --- |
| Full CommonMark / GFM parity | Partial | Focus is streamed AI-response subset correctness |
| HTML element parsing depth | Partial | Simple supported element structures only |
| Mermaid UX richness | Partial | Diagram rendering exists; not a full diagram IDE |
| General-purpose markdown library ergonomics | Partial | Public API remains intentionally small |

## Parity harness coverage

The parity corpus currently tracks:

- inline and block math fixtures
- nested inline and block HTML fixtures
- inline and block directive fixtures
- streamed code-growth fixture coverage

The streamed code-growth coverage specifically locks the append-heavy path used
for AI responses so code fences can grow without replacing the entire block
shell on each update.

These fixtures exist to keep Incremark-aligned rendered-surface work anchored to
stable inputs instead of ad hoc string literals.

## Theme system coverage

`velomark` now ships a semantic token theme surface that covers:

- text, link, and border colors
- code blocks, inline code, copy controls, and language badges
- blockquotes, tables, and math fallback surfaces
- Mermaid diagram theme variables derived from the active `VelomarkTheme`
- typography, radius, shadow, and spacing primitives

The intended public contract is:

- `default` preset
- `dark` preset
- partial object overrides merged into the default preset
- container-scoped application through generated CSS variables
