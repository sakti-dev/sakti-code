<p>
  <img width="100%" src="https://assets.solidjs.com/banner?type=velomark&background=tiles&project=%20" alt="velomark">
</p>

# velomark

[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg?style=for-the-badge&logo=pnpm)](https://pnpm.io/)

Solid-only Markdown rendering built for streamed AI responses.[^incremark]

`velomark` is a public npm package for apps that need Markdown rendering to stay responsive while content is still arriving. It is optimized for append-heavy streams, stable DOM identity for already-rendered blocks, and a restrained Solid-first API that is easy to integrate into product code.

## Why use velomark?

- Streaming-first rendering instead of snapshot-first repainting
- Stable block reuse so earlier content keeps its DOM identity when later content grows
- Solid-only package surface with no framework abstraction layer
- Strong built-in syntax surface for the Markdown features common in coding-agent output
- Built-in defaults for code blocks, Mermaid, math, footnotes, directives, tables, and HTML
- First-class theming with semantic tokens, light and dark presets, and partial overrides

## Requirements

- `solid-js` `^1.9.10`
- Node.js `>=18`
- A stylesheet import from `velomark/styles.css`

## Install

```bash
pnpm add velomark solid-js
```

You can also use `npm` or `yarn` if that is what your app already uses.

## Quick start

```tsx
import { Velomark } from "velomark";
import "velomark/styles.css";

const markdown = `# Hello

This is **streamed** Markdown.

\`\`\`ts
const answer = 42;
\`\`\`
`;

export function Example() {
  return <Velomark markdown={markdown} />;
}
```

## Common integration examples

### Render a live stream

```tsx
import { createSignal } from "solid-js";
import { Velomark } from "velomark";
import "velomark/styles.css";

export function StreamingExample() {
  const [markdown, setMarkdown] = createSignal("# Thinking");

  const append = (chunk: string) => {
    setMarkdown(current => current + chunk);
  };

  return (
    <>
      <button onClick={() => append("\n\nMore content arrived.")}>Append</button>
      <Velomark markdown={markdown()} />
    </>
  );
}
```

### Use the built-in dark theme

```tsx
import { Velomark } from "velomark";
import "velomark/styles.css";

export function DarkExample(props: { markdown: string }) {
  return <Velomark markdown={props.markdown} theme="dark" />;
}
```

### Override part of the theme

```tsx
import { Velomark } from "velomark";
import "velomark/styles.css";

export function BrandedExample(props: { markdown: string }) {
  return (
    <Velomark
      markdown={props.markdown}
      theme={{
        color: {
          text: {
            accent: "#0f62fe",
          },
          diagram: {
            primary: "#0f62fe",
            secondary: "#78a9ff",
          },
        },
      }}
    />
  );
}
```

### Apply a theme to a host element

```ts
import { applyTheme } from "velomark";

const host = document.querySelector(".markdown-preview");

if (host instanceof HTMLElement) {
  applyTheme(host, "dark");
}
```

### Override a language-specific code block renderer

```tsx
import type { VelomarkCodeBlockRendererProps } from "velomark";
import { Velomark } from "velomark";
import "velomark/styles.css";

function JsonBlock(props: VelomarkCodeBlockRendererProps) {
  return (
    <pre>
      <code>{JSON.stringify(JSON.parse(props.code), null, 2)}</code>
    </pre>
  );
}

export function CustomCodeExample(props: { markdown: string }) {
  return (
    <Velomark
      codeBlockRenderers={{
        json: JsonBlock,
      }}
      markdown={props.markdown}
    />
  );
}
```

### Override a directive container

```tsx
import type { VelomarkContainerRendererProps } from "velomark";
import { Velomark } from "velomark";
import "velomark/styles.css";

function Callout(props: VelomarkContainerRendererProps) {
  return (
    <aside data-callout={props.name}>
      <strong>{props.attributes?.title ?? "Note"}</strong>
      <div>{props.children}</div>
    </aside>
  );
}

export function CustomContainerExample(props: { markdown: string }) {
  return (
    <Velomark
      containers={{
        info: Callout,
        warning: Callout,
      }}
      markdown={props.markdown}
    />
  );
}
```

## What Velomark renders well

### Core blocks

- Paragraphs and headings
- Ordered, unordered, nested, and task lists
- Blockquotes
- Fenced code blocks with syntax highlighting
- Mermaid fences rendered as diagrams
- Tables with column alignment
- Thematic breaks
- Footnote definitions
- Math blocks
- Raw HTML blocks and structured HTML elements
- Container, leaf, and text directives

### Inline syntax

- Strong, emphasis, delete, and inline code
- Links and images
- Hard line breaks
- Footnote references
- Inline math
- Raw inline HTML and structured inline HTML elements
- Reference-style links and images, including collapsed and shortcut forms

### Streaming behavior

- Append-heavy content growth
- Tail rewrites
- Incomplete intermediate states for fences, references, directives, HTML, and tables
- Stable outer code-block shell while highlighted code grows

For the full status matrix, see [docs/feature-matrix.md](./docs/feature-matrix.md).

## Code blocks and Mermaid

`velomark` ships generic built-in code block behavior by default:

- syntax highlighting for supported fenced languages
- a floating copy button for standard code fences
- a floating language badge when a language exists
- theme-aware colors for code surfaces

Mermaid uses its own dedicated rendering path:

- successful Mermaid fences render as diagrams, not as generic code blocks
- incomplete streaming fences stay in plain code mode until the fence is complete
- invalid diagrams fall back to source rendering instead of failing the whole block
- diagram colors are derived from the active `VelomarkTheme`

You can tune standard code blocks with `codeBlockOptions`:

```tsx
<Velomark
  codeBlockOptions={{
    copyButton: true,
    highlight: true,
    highlightTheme: "github-dark",
    languageLabel: true,
  }}
  markdown={markdown}
/>
```

## Theming

`velomark` uses semantic theme tokens instead of ad hoc component color props.

Built-in presets:

- `default`
- `dark`

Public theme utilities:

```ts
import {
  applyTheme,
  darkTheme,
  defaultTheme,
  generateCssVars,
  mergeTheme,
  resolveTheme,
  velomarkColors,
  velomarkThemePresets,
  velomarkTokens,
} from "velomark";
```

The public contract is:

- use `theme="default"` or `theme="dark"`
- pass a partial `VelomarkTheme` object when you need to override specific semantic tokens
- use `applyTheme` or `generateCssVars` when you need container-scoped control outside the component

Theme coverage includes:

- text and link colors
- code blocks, inline code, copy controls, and language badges
- blockquotes, tables, and math fallback surfaces
- Mermaid diagram theme variables
- typography, radius, shadow, and spacing tokens

## Public API

### Component

```ts
interface VelomarkProps {
  class?: string;
  codeBlockOptions?: {
    copyButton?: boolean;
    defaultView?: "preview" | "source";
    highlight?: boolean;
    highlightTheme?: string;
    languageLabel?: boolean;
    previewToggle?: boolean;
  };
  codeBlockRenderers?: Record;
  containers?: Record;
  debug?: boolean;
  markdown: string;
  onDebugMetrics?: (metrics: VelomarkDebugMetrics) => void;
  theme?: "default" | "dark" | Partial;
}
```

### Key exported types

```ts
import type {
  InlineToken,
  PartialVelomarkTheme,
  RenderBlock,
  RenderDocument,
  VelomarkCodeBlockOptions,
  VelomarkCodeBlockRendererProps,
  VelomarkContainerRendererProps,
  VelomarkProps,
  VelomarkTheme,
  VelomarkThemeName,
} from "velomark";
```

### Parser export

`parseInline` is exported for advanced consumers that need inline-token parsing outside the component.

## Security and trust model

`velomark` supports raw HTML and structured HTML rendering. If your Markdown source is untrusted, sanitize it before you pass it into `Velomark`.

This package focuses on rendering and streaming behavior. It does not try to be an HTML sanitizer.

## Troubleshooting

### The Markdown renders with no styling

You probably forgot the stylesheet import:

```ts
import "velomark/styles.css";
```

### Code fences render without syntax highlighting

Check these first:

- the fence has a language, for example ` ```ts `
- `codeBlockOptions.highlight` is not disabled
- the requested language is supported by the active highlighter setup

Unlabeled fences intentionally render as plain code.

### Mermaid falls back to source

That is expected when:

- the fence is still streaming and incomplete
- the Mermaid source is invalid
- Mermaid cannot finish rendering the diagram

### The consumer gets a Solid peer dependency warning

Make sure the app uses `solid-js` `^1.9.10` or newer within the supported major range.

## FAQ

### Is Velomark a full CommonMark or GFM engine?

Not in the abstract “everything Markdown supports” sense. It targets the syntax and rendered surface that matter most for streamed AI and coding-assistant output, and it has strong coverage for that subset.

### Does it support React, Vue, or Svelte?

No. `velomark` is intentionally Solid-only.

### Can I override rendering?

Yes, but the public API is intentionally restrained. Today the main extension seams are:

- `codeBlockRenderers`
- `containers`
- theme overrides
- `onDebugMetrics`

### Is the playground part of the runtime package?

No. The dev playground exists to inspect streamed behavior and theme previews during package development. It is not a runtime dependency of published consumers.

## Development

```bash
pnpm install --ignore-workspace
pnpm exec vitest run
pnpm run lint:types
pnpm run lint:code
pnpm run build
pnpm run test:packed-consumer
```

To inspect the local playground:

```bash
pnpm run dev
```

[^incremark]: Velomark is inspired by the renderer goals and streaming ergonomics explored in Incremark, while keeping a smaller Solid-only public surface.
