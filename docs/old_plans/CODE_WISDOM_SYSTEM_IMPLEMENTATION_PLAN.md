# Code Wisdom System - Implementation Plan

## Problem Statement

Current memory systems in ekacode focus on:

- **Observational memory**: Capturing agent observations during work
- **Task memory**: Tracking tasks and their dependencies
- **Mastra memory**: General conversation context

What's missing: **User-managed knowledge base** for:

- Personal coding principles (e.g., "always use TDD", "clean code practices")
- Best practices learned (e.g., "use XState for complex state machines")
- Gotchas / lessons learned (e.g., "don't use Zustand with duplicate IDs")
- Project-specific conventions

**Key insight**: The agent often retrieves best practices but misses the gotchas. A user stores "XState is great for state machines" but forgets to store "but avoid nested machines > 3 levels deep".

---

## Design Principles

### 1. Single Store, Rich Tags

Keep wisdom entries flat with semantic tags. The retrieval logic ensures both guidance AND warnings are fetched together.

```
Wisdom Entry:
├── content: "Don't use Zustand with duplicate ID references"
├── type: gotcha | principle | preference
├── tags: ["zustand", "state-management", "gotcha"]
└── createdAt, updatedAt
```

### 2. Tag-Driven Retrieval

When retrieving wisdom:

- Primary filter: tags (e.g., "zustand")
- Always include both: `principles` AND `gotchas`
- Secondary: full-text search for context

**The agent should NEVER fetch best practices without also fetching the gotchas.**

### 3. LLM-Powered Intent Detection

The `/learn` command accepts natural language. The LLM parses:

- What action to take (add, update, delete, query)
- What type of wisdom (principle, gotcha, preference)
- What tags to extract
- The actual content

### 4. Auto-Tagging

The LLM extracts tags from content automatically:

- "failed xstate attempt" → tags: `["xstate", "state-machine", "gotcha"]`
- "our testing principle" → tags: `["testing", "principle"]`

---

## Data Model

### Database: SQLite (libsql)

Using existing `packages/server/src/db/schema.ts` pattern with Drizzle.

```typescript
// packages/server/src/db/schema/wisdom.ts

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Wisdom entries table
export const wisdomEntries = sqliteTable("wisdom_entries", {
  id: text("id").primaryKey(), // UUIDv7

  // Content
  content: text("content").notNull(),

  // Type: principle | gotcha | preference
  type: text("type").notNull(),

  // Tags stored as JSON array
  tags: text("tags").notNull(), // JSON array: '["zustand", "state"]'

  // Source (optional): how this was learned
  source: text("source"), // e.g., "error: zustand-duplicate-id"

  // Metadata
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`UNIXEPOCH()`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`UNIXEPOCH()`),
});

// FTS5 virtual table for full-text search
export const wisdomFts = sqliteTable("wisdom_fts", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  tags: text("tags").notNull(),
});
```

### Tag Junction Table

For efficient tag queries:

```typescript
// Tag management
export const wisdomTags = sqliteTable("wisdom_tags", {
  id: text("id").primaryKey(), // UUIDv7
  name: text("name").notNull().unique(), // "zustand", "testing", "tdd"
  category: text("category"), // "library", "principle", "pattern"
});

// Junction table
export const wisdomEntryTags = sqliteTable("wisdom_entry_tags", {
  entryId: text("entry_id")
    .notNull()
    .references(() => wisdomEntries.id),
  tagId: text("tag_id")
    .notNull()
    .references(() => wisdomTags.id),
});
```

### TypeScript Types

```typescript
// packages/core/src/types/wisdom.ts

export type WisdomType = "principle" | "gotcha" | "preference";

export interface WisdomEntry {
  id: string;
  content: string;
  type: WisdomType;
  tags: string[];
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WisdomTag {
  id: string;
  name: string;
  category?: string;
}

export interface WisdomQuery {
  tags?: string[];
  types?: WisdomType[]; // If not specified, include all
  search?: string; // Full-text search
  limit?: number;
}
```

---

## CRUD Operations

### 1. Create Wisdom Entry

```typescript
// packages/core/src/memory/wisdom.ts

import { v4 as uuidv7 } from "uuid";
import { db } from "@ekacode/server/db";
import { wisdomEntries, wisdomTags, wisdomEntryTags } from "@ekacode/server/db/schema/wisdom";

export async function createWisdomEntry(params: {
  content: string;
  type: WisdomType;
  tags: string[];
  source?: string;
}): Promise<WisdomEntry> {
  const id = uuidv7();
  const now = new Date();

  // Insert entry
  await db.insert(wisdomEntries).values({
    id,
    content: params.content,
    type: params.type,
    tags: JSON.stringify(params.tags),
    source: params.source ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // Upsert tags and create junctions
  for (const tagName of params.tags) {
    const tagId = await upsertTag(tagName);
    await db
      .insert(wisdomEntryTags)
      .values({
        entryId: id,
        tagId,
      })
      .onConflictDoNothing();
  }

  return {
    id,
    content: params.content,
    type: params.type,
    tags: params.tags,
    source: params.source,
    createdAt: now,
    updatedAt: now,
  };
}

async function upsertTag(name: string): Promise<string> {
  const normalized = name.toLowerCase().trim();

  const existing = await db.query.wisdomTags.findFirst({
    where: (tags, { eq }) => eq(tags.name, normalized),
  });

  if (existing) return existing.id;

  const id = uuidv7();
  await db.insert(wisdomTags).values({ id, name: normalized });
  return id;
}
```

### 2. Update Wisdom Entry

```typescript
export async function updateWisdomEntry(params: {
  id: string;
  content?: string;
  type?: WisdomType;
  tags?: string[];
}): Promise<WisdomEntry> {
  const existing = await db.query.wisdomEntries.findFirst({
    where: (entries, { eq }) => eq(entries.id, params.id),
  });

  if (!existing) throw new Error(`Wisdom entry ${params.id} not found`);

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (params.content !== undefined) updates.content = params.content;
  if (params.type !== undefined) updates.type = params.type;
  if (params.tags !== undefined) {
    updates.tags = JSON.stringify(params.tags);

    // Rebuild tag junctions
    await db.delete(wisdomEntryTags).where(eq(wisdomEntryTags.entryId, params.id));

    for (const tagName of params.tags) {
      const tagId = await upsertTag(tagName);
      await db
        .insert(wisdomEntryTags)
        .values({
          entryId: params.id,
          tagId,
        })
        .onConflictDoNothing();
    }
  }

  await db.update(wisdomEntries).set(updates).where(eq(wisdomEntries.id, params.id));

  return getWisdomEntry(params.id);
}
```

### 3. Delete Wisdom Entry

```typescript
export async function deleteWisdomEntry(id: string): Promise<void> {
  // Delete junctions first
  await db.delete(wisdomEntryTags).where(eq(wisdomEntryTags.entryId, id));

  // Delete entry
  await db.delete(wisdomEntries).where(eq(wisdomEntries.id, id));
}
```

### 4. Query Wisdom Entries

```typescript
export async function queryWisdom(params: WisdomQuery): Promise<WisdomEntry[]> {
  const { tags, types, search, limit = 20 } = params;

  let results: WisdomEntry[] = [];

  if (tags && tags.length > 0) {
    // Tag-based query via junction
    const tagIds = await db.query.wisdomTags.findMany({
      where: (t, { inArray }) =>
        inArray(
          t.name,
          tags.map(t => t.toLowerCase())
        ),
    });

    if (tagIds.length === 0) return [];

    const entryIds = await db.query.wisdomEntryTags.findMany({
      where: (et, { inArray }) =>
        inArray(
          et.tagId,
          tagIds.map(t => t.id)
        ),
    });

    const uniqueIds = [...new Set(entryIds.map(et => et.entryId))];

    results = await db.query.wisdomEntries.findMany({
      where: (e, { inArray }) => inArray(e.id, uniqueIds),
    });
  } else {
    results = await db.query.wisdomEntries.findMany({
      limit,
    });
  }

  // Filter by type (default: all types)
  if (types && types.length > 0) {
    results = results.filter(r => types.includes(r.type));
  }

  // Full-text search (if provided)
  if (search) {
    const searchLower = search.toLowerCase();
    results = results.filter(
      r =>
        r.content.toLowerCase().includes(searchLower) ||
        r.tags.some(t => t.toLowerCase().includes(searchLower))
    );
  }

  // Parse tags from JSON
  return results.map(r => ({
    ...r,
    tags: JSON.parse(r.tags as unknown as string),
  }));
}
```

---

## /learn Command Implementation

### Command Handler

```typescript
// packages/core/src/tools/wisdom.ts

import { tool } from "ai";
import { z } from "zod";
import {
  createWisdomEntry,
  updateWisdomEntry,
  deleteWisdomEntry,
  queryWisdom,
} from "../memory/wisdom";
import { WisdomType } from "../types/wisdom";

const learnTool = tool({
  description: `Learn from user input - store or retrieve coding wisdom.
  
Use this to:
- Add principles, best practices, or gotchas from conversation
- Query stored wisdom for relevant guidance
- Update or delete existing entries

The LLM will determine intent from natural language.`,

  inputSchema: z.object({
    input: z.string().describe("Natural language input for the LLM to parse"),
  }),

  execute: async (params, context) => {
    const { input } = params;

    // LLM parses intent from input
    const parsed = await parseLearnIntent(input);

    switch (parsed.action) {
      case "add":
        return handleAdd(parsed);
      case "update":
        return handleUpdate(parsed);
      case "delete":
        return handleDelete(parsed);
      case "query":
        return handleQuery(parsed);
      default:
        return handleInteractive(parsed);
    }
  },
});

async function parseLearnIntent(input: string): Promise<{
  action: "add" | "update" | "delete" | "query" | "interactive";
  content?: string;
  type?: WisdomType;
  tags?: string[];
  id?: string;
  search?: string;
}> {
  // This is handled by the LLM itself - we provide the schema
  // The LLM sees the input and determines:
  // - "store this as gotcha" → action: add, type: gotcha
  // - "what are the zustand gotchas" → action: query, tags: ['zustand']
  // - "update the xstate entry" → action: update

  // We'll use a system prompt to guide the LLM's decision
  // The actual parsing happens in the prompt, not here

  return {
    action: "interactive", // Default - will ask user
  };
}
```

### Better Approach: LLM-Driven Parsing

Instead of trying to parse in code, the `/learn` tool receives the raw input and the LLM decides what to do:

```typescript
// The actual implementation - the LLM figures out intent

const learnTool = tool({
  description: `Manage code wisdom - store or retrieve coding principles, best practices, and gotchas.

USER COMMANDS (the LLM parses these):
- "/learn store this as a gotcha: when using zustand, don't use duplicate keys in selectors"
- "/learn what are the xstate gotchas?"
- "/learn add this as our principle: always write tests first"
- "/learn update the zustand entry with new info"
- "/learn delete that old principle"
- "/learn" (interactive - asks user what to do)

WISDOM TYPES:
- "principle": Guidelines, best practices (e.g., "use TDD", "keep functions small")
- "gotcha": Lessons learned, warnings, mistakes (e.g., "don't use duplicate IDs in Zustand")
- "preference": User/project preferences (e.g., "use 2-space indentation", "prefer const over let")

TAG EXTRACTION (auto-detected from content):
- Technology: zustand, xstate, react, solidjs
- Concepts: tdd, clean-code, state-management, testing
- Patterns: state-machine, singleton, observer
- Project-specific: (any relevant tag)

CRITICAL: When QUERYING, always fetch ALL types (principles + gotchas + preferences).
Never return only best practices without gotchas - users need both!`,

  inputSchema: z.object({
    action: z.enum(['add', 'update', 'delete', 'query'])
      .describe("Action: add=store new wisdom, update=modify existing, delete=remove, query=search"),

    // For add/update
    content: z.string().optional()
      .describe("The wisdom content (for add/update). E.g., 'don't use duplicate keys in selectors'"),
    type: z.enum(['principle', 'gotcha', 'preference']).optional()
      .describe("Type of wisdom: principle|gotcha|preference"),
    tags: z.array(z.string()).optional()
      .describe("Tags for this wisdom. E.g., ['zustand', 'selectors', 'bug']"),

    // For query
    query: z.string().optional()
      .describe("Search query text (for query). E.g., 'zustand selector bug'"),
    queryTags: z.array(z.string()).optional()
      .describe("Filter by tags (for query). E.g., ['zustand']"),
    includeTypes: z.array(z.enum(['principle', 'gotcha', 'preference'])).optional()
      .describe("Which types to include. Default: ALL types (principle, gotcha, preference)"),

    // For update/delete
    id: z.string().optional()
      .describe("Entry ID (for update/delete). Find by searching content first if unknown"),
  }),

  execute: async (params, context) => {
    const { action, content, type, tags, query, queryTags, includeTypes, id } = params;

    switch (action) {
      case 'add':
        if (!content || !type || !tags || tags.length === 0) {
          return {
            error: 'Missing required fields for add',
            required: 'content (string), type (principle|gotcha|preference), tags (array with at least 1 tag)',
            example: '{ action: "add", content: "don't use duplicate keys in selectors", type: "gotcha", tags: ["zustand", "selectors"] }'
          };
        }
        const entry = await createWisdomEntry({ content, type, tags });
        return { success: true, entry };

      case 'update':
        if (!id) return { error: 'Missing id for update. First query to find the entry.' };
        const updated = await updateWisdomEntry({ id, content, type, tags });
        return { success: true, entry: updated };

      case 'delete':
        if (!id) return { error: 'Missing id for delete. First query to find the entry.' };
        await deleteWisdomEntry(id);
        return { success: true, message: 'Deleted wisdom entry' };

      case 'query':
        // CRITICAL: If includeTypes not specified, include ALL types
        const typesToFetch = includeTypes && includeTypes.length > 0
          ? includeTypes
          : ['principle', 'gotcha', 'preference'];

        const results = await queryWisdom({
          tags: queryTags,
          types: typesToFetch,
          search: query,
        });
        return {
          results,
          summary: {
            principles: results.filter(r => r.type === 'principle').length,
            gotchas: results.filter(r => r.type === 'gotcha').length,
            preferences: results.filter(r => r.type === 'preference').length,
          }
        };

      default:
        return { error: 'Unknown action. Use: add, update, delete, or query' };
    }
  }
});
```

### Prompt for LLM Intent Detection

The system prompt guides the LLM - include this in the agent's system prompt:

```markdown
## /learn Command - Intent Detection

When user types /learn [input], you MUST parse the intent and call the learn tool with correct parameters.

### DETECTING ACTION:

| User says...                                                       | Action        | Example                                              |
| ------------------------------------------------------------------ | ------------- | ---------------------------------------------------- |
| "store this", "remember", "add this as", "learn this", "this is a" | add           | "/learn store: zustand selectors should use shallow" |
| "update", "change", "modify", "edit"                               | update        | "/learn update the zustand entry"                    |
| "delete", "remove", "forget"                                       | delete        | "/learn delete that old principle"                   |
| "what are", "show me", "list", "get", "how do I", "gotchas about"  | query         | "/learn what are the xstate gotchas?"                |
| Just "/learn" with no input                                        | query (empty) | Returns all wisdom                                   |

### DETECTING TYPE (for add/update):

| User says...                                                       | Type       |
| ------------------------------------------------------------------ | ---------- |
| "principle", "best practice", "guideline", "rule", "should always" | principle  |
| "gotcha", "warning", "mistake", "failed", "bug", "don't", "never"  | gotcha     |
| "preference", "we prefer", "our convention", "we use"              | preference |

### DETECTING TAGS (auto-extract from content):

Extract ALL relevant tags from the content:

- "zustand selector bug" → tags: ["zustand", "selectors", "bug"]
- "xstate nested machines cause issues" → tags: ["xstate", "nested-machines", "gotcha"]
- "TDD principle" → tags: ["tdd", "testing", "principle"]

### QUERY EXAMPLES:

User: "/learn what are the zustand gotchas?"
```

{ action: "query", queryTags: ["zustand"], includeTypes: ["gotcha", "principle"] }

```

User: "/learn show me all testing principles"
```

{ action: "query", queryTags: ["testing"], includeTypes: ["principle"] }

```

User: "/learn what's our preference for state management?"
```

{ action: "query", queryTags: ["state-management"], includeTypes: ["preference"] }

```

User: "/learn xstate" (no type specified - fetch ALL)
```

{ action: "query", queryTags: ["xstate"] } // includeTypes defaults to ALL

```

### ADD EXAMPLES:

User: "/learn store: when using zustand, never use duplicate keys in selectors, it causes silent re-renders"
```

{
action: "add",
content: "never use duplicate keys in selectors - causes silent re-render bugs",
type: "gotcha",
tags: ["zustand", "selectors", "re-render", "bug"]
}

```

User: "/learn add this as principle: always use TDD"
```

{
action: "add",
content: "always use Test-Driven Development",
type: "principle",
tags: ["tdd", "testing", "development-process"]
}

```

### UPDATE/DELETE EXAMPLES:

First, query to find the ID, then update/delete:

User: "/learn update the zustand selector entry"
1. Query: { action: "query", queryTags: ["zustand", "selectors"] }
2. Find the ID from results
3. Update: { action: "update", id: "<found-id>", content: "new content", tags: ["new", "tags"] }

### CRITICAL RULES:

1. ALWAYS include at least 1 tag for add/update
2. For query, if no includeTypes specified → fetch ALL types (principle + gotcha + preference)
3. Never query only principles - always include gotchas unless user explicitly asks for just principles
4. If uncertain about tags, err on side of more tags
5. If ID unknown for update/delete, first query to find it
```

---

## Retrieval Integration

### The Critical Pattern: ALWAYS Fetch Gotchas

**THIS IS THE KEY INSIGHT OF THIS SYSTEM.**

When any agent retrieves wisdom, it MUST include both principles AND gotchas together:

```typescript
// How other agents/tools query wisdom

async function getWisdomForContext(tags: string[]): Promise<{
  principles: WisdomEntry[];
  gotchas: WisdomEntry[];
  preferences: WisdomEntry[];
}> {
  // CRITICAL: Always fetch ALL types - never filter to only principles!
  // The user stored both best practices AND gotchas for a reason.
  // Agent should NEVER see "use XState" without also seeing "but avoid nested machines"
  const all = await queryWisdom({
    tags,
    // NO types filter = fetches all types by default
  });

  return {
    principles: all.filter(e => e.type === "principle"),
    gotchas: all.filter(e => e.type === "gotcha"),
    preferences: all.filter(e => e.type === "preference"),
  };
}

// DON'T DO THIS:
// const results = await queryWisdom({ tags, types: ['principle'] }); // WRONG!

// DO THIS:
// const results = await queryWisdom({ tags }); // Returns ALL types including gotchas
```

### When to Inject Wisdom Context

Inject wisdom into agent context when:

- Agent is about to implement something with a known library/pattern
- User mentions a technology (zustand, xstate, react, etc.)
- Agent encounters an error that matches a known gotcha

```typescript
// Example: Agent about to use Zustand
async function beforeUsingZustand(): Promise<string> {
  const wisdom = await getWisdomForContext(["zustand", "state-management"]);

  let context = "\n## Code Wisdom for Zustand\n";

  if (wisdom.principles.length > 0) {
    context += "\n### Best Practices\n";
    for (const p of wisdom.principles) {
      context += `- ${p.content}\n`;
    }
  }

  if (wisdom.gotchas.length > 0) {
    context += "\n### ⚠️ Gotchas (Must Read!)\n";
    for (const g of wisdom.gotchas) {
      context += `- ⚠️ ${g.content}\n`;
    }
  }

  if (wisdom.preferences.length > 0) {
    context += "\n### Preferences\n";
    for (const p of wisdom.preferences) {
      context += `- ${p.content}\n`;
    }
  }

  return context;
}

// Agent sees:
// ## Code Wisdom for Zustand
//
// ### Best Practices
// - Use Zustand for client-side state
// - Keep store slices modular
//
// ### ⚠️ Gotchas (Must Read!)
// - ⚠️ Never use duplicate keys in selectors - causes silent re-render bugs
// - ⚠️ Always use shallow equality for selectors
//
// ### Preferences
// - Use create<Name>Store naming convention
```

### Integration with Observational Memory

When explore agent or other agents need wisdom:

```typescript
// In explore agent prompt or memory context

async function injectWisdomContext(tags: string[]): Promise<string> {
  const wisdom = await getWisdomForContext(tags);

  let context = "\n## Relevant Code Wisdom\n";

  if (wisdom.principles.length > 0) {
    context += "\n### Principles\n";
    for (const p of wisdom.principles) {
      context += `- ${p.content}\n`;
    }
  }

  if (wisdom.gotchas.length > 0) {
    context += "\n### Gotchas (Important!)\n";
    for (const g of wisdom.gotchas) {
      context += `- ⚠️ ${g.content}\n`;
    }
  }

  if (wisdom.preferences.length > 0) {
    context += "\n### Preferences\n";
    for (const p of wisdom.preferences) {
      context += `- ${p.content}\n`;
    }
  }

  return context;
}
```

### Example: Before Implementing State Management

```typescript
// Agent workflow when user says "add state management"

// 1. Query wisdom for "zustand" or "state-management"
const wisdom = await getWisdomForContext(["zustand", "state-management"]);

// 2. Inject into agent context
const context = await injectWisdomContext(["zustand"]);

// 3. Agent sees:
// ## Relevant Code Wisdom
//
// ### Principles
// - Use Zustand for client-side state
// - Keep store slices modular
//
// ### Gotchas (Important!)
// - ⚠️ Don't use duplicate ID references in store - causes silent bugs
// - ⚠️ Always use shallow equality for selectors
// - ⚠️ Avoid creating new objects in render - causes re-renders
```

---

## Tag System Design

### Predefined Tag Categories

| Category              | Examples                           |
| --------------------- | ---------------------------------- |
| **library/framework** | zustand, xstate, react, solidjs    |
| **pattern**           | state-machine, singleton, observer |
| **principle**         | tdd, clean-code, solid, dry        |
| **practice**          | testing, linting, typescript       |
| **project**           | (project-specific tags)            |

### Tag Inference

The LLM auto-generates tags from content:

| Content                        | Extracted Tags                      |
| ------------------------------ | ----------------------------------- |
| "failed xstate nested machine" | xstate, state-machine, gotcha       |
| "our TDD principle"            | tdd, testing, principle             |
| "zustand duplicate ID bug"     | zustand, id-referencing, gotcha     |
| "use clean architecture"       | clean-code, architecture, principle |

### Tag Suggestions

When adding wisdom, suggest existing tags:

```typescript
export async function getTagSuggestions(partial: string): Promise<string[]> {
  return db.query.wisdomTags
    .findMany({
      where: (t, { like }) => like(t.name, `${partial}%`),
      limit: 10,
    })
    .then(tags => tags.map(t => t.name));
}
```

---

## Slash Command Handler

### Server Route

```typescript
// packages/server/src/routes/wisdom.ts

import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseLearnInput, executeLearnAction } from "@ekacode/core/memory/wisdom";

const wisdom = new Hono();

// Handle /learn command
wisdom.post("/learn", async c => {
  const { input } = await c.req.json();

  // LLM parses intent
  const parsed = await parseLearnInput(input);

  // Execute action
  const result = await executeLearnAction(parsed);

  return c.json(result);
});

// Query wisdom
wisdom.get("/wisdom", async c => {
  const tags = c.req.query("tags")?.split(",");
  const types = c.req.query("types")?.split(",");
  const query = c.req.query("q");

  const results = await queryWisdom({ tags, types, search: query });
  return c.json({ results });
});
```

### Desktop Integration

```typescript
// apps/desktop/src/core/wisdom/hooks/useWisdom.ts

import { createSignal } from "solid-js";

export function useWisdom() {
  const [wisdom, setWisdom] = createSignal<WisdomEntry[]>([]);
  const [loading, setLoading] = createSignal(false);

  async function query(tags: string[]) {
    setLoading(true);
    const results = await api.queryWisdom({ tags });
    setWisdom(results);
    setLoading(false);
  }

  return { wisdom, loading, query };
}
```

---

## UI Components

### Wisdom Panel (Optional)

For viewing/managing wisdom:

```tsx
// apps/desktop/src/views/wisdom-panel.tsx

import { Component, For, Show } from "solid-js";

interface WisdomPanelProps {
  entries: WisdomEntry[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export const WisdomPanel: Component<WisdomPanelProps> = props => {
  return (
    <div class="wisdom-panel">
      <For each={props.entries}>
        {entry => (
          <div class={`wisdom-card ${entry.type}`}>
            <div class="wisdom-tags">
              <For each={entry.tags}>{tag => <span class="tag">{tag}</span>}</For>
            </div>
            <p class="wisdom-content">{entry.content}</p>
            <div class="wisdom-actions">
              <button onClick={() => props.onEdit(entry.id)}>Edit</button>
              <button onClick={() => props.onDelete(entry.id)}>Delete</button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
```

---

## Implementation Phases

### Phase 1: Database & Core (This PR)

- [ ] Add Drizzle schema for `wisdom_entries`, `wisdom_tags`, `wisdom_entry_tags`
- [ ] Create migration for SQLite
- [ ] Implement CRUD operations in `packages/core/src/memory/wisdom.ts`
- [ ] Add TypeScript types

### Phase 2: Tool Definition

- [ ] Create `/learn` tool in `packages/core/src/tools/wisdom.ts`
- [ ] Define input schema with action dispatch
- [ ] Add system prompt for LLM intent detection
- [ ] Test natural language parsing

### Phase 3: Retrieval Integration

- [ ] Add `getWisdomForContext()` helper
- [ ] Add `injectWisdomContext()` for prompt injection
- [ ] Integrate with explore agent prompts
- [ ] Document how other agents should use wisdom

### Phase 4: UI (Optional)

- [ ] Wisdom panel component
- [ ] Tag display and filtering
- [ ] Direct CRUD from UI

---

## Migration

### SQL Migration

```sql
-- Migration: add_wisdom_tables.sql

-- Wisdom entries
CREATE TABLE IF NOT EXISTS wisdom_entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('principle', 'gotcha', 'preference')),
  tags TEXT NOT NULL, -- JSON array
  source TEXT,
  created_at INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated_at INTEGER NOT NULL DEFAULT (UNIXEPOCH())
);

-- Tags
CREATE TABLE IF NOT EXISTS wisdom_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT
);

-- Junction
CREATE TABLE IF NOT EXISTS wisdom_entry_tags (
  entry_id TEXT NOT NULL REFERENCES wisdom_entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES wisdom_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

-- Index for tag queries
CREATE INDEX IF NOT EXISTS idx_wisdom_entry_tags_entry ON wisdom_entry_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_wisdom_entry_tags_tag ON wisdom_entry_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_wisdom_tags_name ON wisdom_tags(name);

-- FTS for full-text search (optional, can use LIKE for small dataset)
-- CREATE VIRTUAL TABLE IF NOT EXISTS wisdom_fts USING fts5(content, tags);
```

---

## Usage Examples

### Adding Wisdom (from conversation)

```
User: /learn store this gotcha: when using zustand, never use duplicate object keys in selectors, it causes silent re-render bugs

LLM calls learn tool:
{
  action: "add",
  content: "never use duplicate object keys in selectors - causes silent re-render bugs",
  type: "gotcha",
  tags: ["zustand", "selectors", "re-render", "bug"]
}

→ Stored in DB with tags: zustand, selectors, re-render, bug
```

```
User: /learn add this as our principle: always write tests first

LLM calls learn tool:
{
  action: "add",
  content: "always write tests first (Test-Driven Development)",
  type: "principle",
  tags: ["tdd", "testing", "development-process"]
}
```

```
User: /learn we prefer to use xstate for complex state machines

LLM calls learn tool:
{
  action: "add",
  content: "prefer XState for complex state machines over other solutions",
  type: "preference",
  tags: ["xstate", "state-machine", "preference"]
}
```

### Querying Wisdom

```
User: /learn what are the zustand gotchas?

LLM calls learn tool:
{
  action: "query",
  queryTags: ["zustand"],
  includeTypes: ["gotcha", "principle"]  // Always include both!
}

Returns:
{
  results: [
    { type: "gotcha", content: "never use duplicate keys in selectors..." },
    { type: "principle", content: "use shallow equality for selectors..." }
  ]
}
```

```
User: /learn show me all testing principles

LLM calls learn tool:
{
  action: "query",
  queryTags: ["testing"],
  includeTypes: ["principle"]
}
```

```
User: /learn what's our preference for state management?

LLM calls learn tool:
{
  action: "query",
  queryTags: ["state-management"],
  includeTypes: ["preference"]
}
```

```
User: /learn xstate (just search for anything xstate)

LLM calls learn tool:
{
  action: "query",
  queryTags: ["xstate"]
  // includeTypes defaults to ALL: principle + gotcha + preference
}
```

### Updating Wisdom

```
User: /learn update the zustand selector gotcha to include more details

LLM:
1. First queries: { action: "query", queryTags: ["zustand", "selectors"] }
2. Finds entry with id: "uuid-123"
3. Calls update: {
    action: "update",
    id: "uuid-123",
    content: "updated content with more details",
    tags: ["zustand", "selectors", "updated"]
  }
```

### Deleting Wisdom

```
User: /learn delete that old principle about tabs

LLM:
1. First queries: { action: "query", queryTags: ["tabs"], includeTypes: ["principle"] }
2. Finds entry with id: "uuid-456"
3. Calls delete: { action: "delete", id: "uuid-456" }
```

### Agent Auto-Retrieval (No User Prompt)

When agent is about to implement something, it should auto-inject wisdom:

```
Agent is about to: create a Zustand store

→ Auto-calls: getWisdomForContext(["zustand"])
→ Injects into context:

   ## Code Wisdom for Zustand

   ### Best Practices
   - Use Zustand for client-side state
   - Keep store slices modular

   ### ⚠️ Gotchas (Must Read!)
   - ⚠️ Never use duplicate keys in selectors - causes silent re-render bugs
   - ⚠️ Always use shallow equality for selectors
```

### Agent Retrieval

```
Agent is about to implement state management:

const wisdom = await getWisdomForContext(['zustand']);
// Returns { principles: [...], gotchas: [...], preferences: [...] }

// Agent includes gotchas in its plan:
"- Use Zustand for state
- ⚠️ Gotcha: Avoid duplicate keys in selectors (causes re-render bugs)"
```

---

## Integration Points

### With Observational Memory

The wisdom system complements observational memory:

- **Observational**: What the agent saw (facts, findings)
- **Wisdom**: What the user taught (principles, gotchas)

### With Task Memory

Wisdom can be tagged with task context:

- tags: ["feature:login", "pattern:state-machine"]

### With Planner

When creating tasks, the planner can suggest relevant wisdom:

- "This task involves XState - here's the relevant wisdom: ..."

---

## Summary

The Code Wisdom system provides:

1. **Single store** with rich tags (no complex categorization)
2. **LLM-powered** `/learn` command (natural language intent)
3. **Auto-tagging** from content
4. **Always-fetches-gotchas** retrieval pattern
5. **Simple SQLite** storage (no BM25 needed)
6. **Integration hooks** for other agents

This gives users a powerful way to teach the agent their principles, preferences, and lessons learned - and ensures the agent NEVER forgets the gotchas when applying best practices.
