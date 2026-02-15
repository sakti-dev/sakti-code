Mastra supports four complementary memory types:
Message history - keeps recent messages from the current conversation so they can be rendered in the UI and used to maintain short-term continuity within the exchange.
Working memory - stores persistent, structured user data such as names, preferences, and goals.
Semantic recall - retrieves relevant messages from older conversations based on semantic meaning rather than exact keywords, mirroring how humans recall information by association. Requires a vector database and an embedding model.

---

# Storage

For agents to remember previous interactions, Mastra needs a database. Use a storage adapter for one of the [supported databases](#supported-providers) and pass it to your Mastra instance.

```typescript
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
});
```

> **Sharing the database with Mastra Studio:** When running `mastra dev` alongside your application (e.g., Next.js), use an absolute path to ensure both processes access the same database:
>
> ```typescript
> url: "file:/absolute/path/to/your/project/mastra.db";
> ```
>
> Relative paths like `file:./mastra.db` resolve based on each process's working directory, which may differ.

This configures instance-level storage, which all agents share by default. You can also configure [agent-level storage](#agent-level-storage) for isolated data boundaries.

Mastra automatically creates the necessary tables on first interaction. See the [core schema](https://mastra.ai/reference/storage/overview) for details on what gets created, including tables for messages, threads, resources, workflows, traces, and evaluation datasets.

## Supported providers

Each provider page includes installation instructions, configuration parameters, and usage examples:

- [libSQL](https://mastra.ai/reference/storage/libsql)
- [PostgreSQL](https://mastra.ai/reference/storage/postgresql)
- [MongoDB](https://mastra.ai/reference/storage/mongodb)
- [Upstash](https://mastra.ai/reference/storage/upstash)
- [Cloudflare D1](https://mastra.ai/reference/storage/cloudflare-d1)
- [Cloudflare Durable Objects](https://mastra.ai/reference/storage/cloudflare)
- [Convex](https://mastra.ai/reference/storage/convex)
- [DynamoDB](https://mastra.ai/reference/storage/dynamodb)
- [LanceDB](https://mastra.ai/reference/storage/lance)
- [Microsoft SQL Server](https://mastra.ai/reference/storage/mssql)

> **Tip:** libSQL is the easiest way to get started because it doesn’t require running a separate database server.

## Configuration scope

Storage can be configured at the instance level (shared by all agents) or at the agent level (isolated to a specific agent).

### Instance-level storage

Add storage to your Mastra instance so all agents, workflows, observability traces and scores share the same memory provider:

```typescript
import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";

export const mastra = new Mastra({
  storage: new PostgresStore({
    id: "mastra-storage",
    connectionString: process.env.DATABASE_URL,
  }),
});

// Both agents inherit storage from the Mastra instance above
const agent1 = new Agent({ id: "agent-1", memory: new Memory() });
const agent2 = new Agent({ id: "agent-2", memory: new Memory() });
```

This is useful when all primitives share the same storage backend and have similar performance, scaling, and operational requirements.

#### Composite storage

[Composite storage](https://mastra.ai/reference/storage/composite) is an alternative way to configure instance-level storage. Use `MastraCompositeStore` to set the `memory` domain (and any other [domains](https://mastra.ai/reference/storage/composite) you need) to different storage providers.

```typescript
import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { MemoryLibSQL } from "@mastra/libsql";
import { WorkflowsPG } from "@mastra/pg";
import { ObservabilityStorageClickhouse } from "@mastra/clickhouse";

export const mastra = new Mastra({
  storage: new MastraCompositeStore({
    id: "composite",
    domains: {
      memory: new MemoryLibSQL({ url: "file:./memory.db" }),
      workflows: new WorkflowsPG({ connectionString: process.env.DATABASE_URL }),
      observability: new ObservabilityStorageClickhouse({
        url: process.env.CLICKHOUSE_URL,
        username: process.env.CLICKHOUSE_USERNAME,
        password: process.env.CLICKHOUSE_PASSWORD,
      }),
    },
  }),
});
```

This is useful when different types of data have different performance or operational requirements, such as low-latency storage for memory, durable storage for workflows, and high-throughput storage for observability.

### Agent-level storage

Agent-level storage overrides storage configured at the instance level. Add storage to a specific agent when you need data boundaries or compliance requirements:

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

export const agent = new Agent({
  id: "agent",
  memory: new Memory({
    storage: new PostgresStore({
      id: "agent-storage",
      connectionString: process.env.AGENT_DATABASE_URL,
    }),
  }),
});
```

> **Warning:** [Mastra Cloud Store](https://mastra.ai/docs/mastra-cloud/deployment) doesn't support agent-level storage.

## Threads and resources

Mastra organizes conversations using two identifiers:

- **Thread** - a conversation session containing a sequence of messages.
- **Resource** - the entity that owns the thread, such as a user, organization, project, or any other domain entity in your application.

Both identifiers are required for agents to store information:

**Generate**:

```typescript
const response = await agent.generate("hello", {
  memory: {
    thread: "conversation-abc-123",
    resource: "user_123",
  },
});
```

**Stream**:

```typescript
const stream = await agent.stream("hello", {
  memory: {
    thread: "conversation-abc-123",
    resource: "user_123",
  },
});
```

> **Note:** [Studio](https://mastra.ai/docs/getting-started/studio) automatically generates a thread and resource ID for you. When calling `stream()` or `generate()` yourself, remember to provide these identifiers explicitly.

### Thread title generation

Mastra can automatically generate descriptive thread titles based on the user's first message when `generateTitle` is enabled.

Use this option when implementing a ChatGPT-style chat interface to render a title alongside each thread in the conversation list (for example, in a sidebar) derived from the thread’s initial user message.

```typescript
export const agent = new Agent({
  id: "agent",
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
});
```

Title generation runs asynchronously after the agent responds and does not affect response time.

To optimize cost or behavior, provide a smaller [`model`](https://mastra.ai/models) and custom `instructions`:

```typescript
export const agent = new Agent({
  id: "agent",
  memory: new Memory({
    options: {
      generateTitle: {
        model: "openai/gpt-4o-mini",
        instructions: "Generate a 1 word title",
      },
    },
  }),
});
```

## Semantic recall

Semantic recall has different storage requirements - it needs a vector database in addition to the standard storage adapter. See [Semantic recall](https://mastra.ai/docs/memory/semantic-recall) for setup and supported vector providers.

## Handling large attachments

Some storage providers enforce record size limits that base64-encoded file attachments (such as images) can exceed:

| Provider                                                           | Record size limit |
| ------------------------------------------------------------------ | ----------------- |
| [DynamoDB](https://mastra.ai/reference/storage/dynamodb)           | 400 KB            |
| [Convex](https://mastra.ai/reference/storage/convex)               | 1 MiB             |
| [Cloudflare D1](https://mastra.ai/reference/storage/cloudflare-d1) | 1 MiB             |

PostgreSQL, MongoDB, and libSQL have higher limits and are generally unaffected.

To avoid this, use an input processor to upload attachments to external storage (S3, R2, GCS, [Convex file storage](https://docs.convex.dev/file-storage), etc.) and replace them with URL references before persistence.

```typescript
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

export class AttachmentUploader implements Processor {
  id = "attachment-uploader";

  async processInput({ messages }: { messages: MastraDBMessage[] }) {
    return Promise.all(messages.map(msg => this.processMessage(msg)));
  }

  async processMessage(msg: MastraDBMessage) {
    const attachments = msg.content.experimental_attachments;
    if (!attachments?.length) return msg;

    const uploaded = await Promise.all(
      attachments.map(async att => {
        // Skip if already a URL
        if (!att.url?.startsWith("data:")) return att;

        // Upload base64 data and replace with URL
        const url = await this.upload(att.url, att.contentType);
        return { ...att, url };
      })
    );

    return { ...msg, content: { ...msg.content, experimental_attachments: uploaded } };
  }

  async upload(dataUri: string, contentType?: string): Promise<string> {
    const base64 = dataUri.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    // Replace with your storage provider (S3, R2, GCS, Convex, etc.)
    // return await s3.upload(buffer, contentType);
    throw new Error("Implement upload() with your storage provider");
  }
}
```

Use the processor with your agent:

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { AttachmentUploader } from "./processors/attachment-uploader";

const agent = new Agent({
  id: "my-agent",
  memory: new Memory({ storage: yourStorage }),
  inputProcessors: [new AttachmentUploader()],
});
```

---

# Message History

Message history is the most basic and important form of memory. It gives the LLM a view of recent messages in the context window, enabling your agent to reference earlier exchanges and respond coherently.

You can also retrieve message history to display past conversations in your UI.

> **Info:** Each message belongs to a thread (the conversation) and a resource (the user or entity it's associated with). See [Threads and resources](https://mastra.ai/docs/memory/storage) for more detail.

## Getting started

Install the Mastra memory module along with a [storage adapter](https://mastra.ai/docs/memory/storage) for your database. The examples below use `@mastra/libsql`, which stores data locally in a `mastra.db` file.

**npm**:

```bash
npm install @mastra/memory@latest @mastra/libsql@latest
```

**pnpm**:

```bash
pnpm add @mastra/memory@latest @mastra/libsql@latest
```

**Yarn**:

```bash
yarn add @mastra/memory@latest @mastra/libsql@latest
```

**Bun**:

```bash
bun add @mastra/memory@latest @mastra/libsql@latest
```

Message history requires a storage adapter to persist conversations. Configure storage on your Mastra instance if you haven't already:

```typescript
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
});
```

Give your agent a `Memory`:

```typescript
import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";

export const agent = new Agent({
  id: "test-agent",
  memory: new Memory({
    options: {
      lastMessages: 10,
    },
  }),
});
```

When you call the agent, messages are automatically saved to the database. You can specify a `threadId`, `resourceId`, and optional `metadata`:

**Generate**:

```typescript
await agent.generate("Hello", {
  memory: {
    thread: {
      id: "thread-123",
      title: "Support conversation",
      metadata: { category: "billing" },
    },
    resource: "user-456",
  },
});
```

**Stream**:

```typescript
await agent.stream("Hello", {
  memory: {
    thread: {
      id: "thread-123",
      title: "Support conversation",
      metadata: { category: "billing" },
    },
    resource: "user-456",
  },
});
```

> **Info:** Threads and messages are created automatically when you call `agent.generate()` or `agent.stream()`, but you can also create them manually with [`createThread()`](https://mastra.ai/reference/memory/createThread) and [`saveMessages()`](https://mastra.ai/reference/memory/memory-class).

There are two ways to use this history:

- **Automatic inclusion** - Mastra automatically fetches and includes recent messages in the context window. By default, it includes the last 10 messages, keeping agents grounded in the conversation. You can adjust this number with `lastMessages`, but in most cases you don't need to think about it.
- [**Manual querying**](#querying) - For more control, use the `recall()` function to query threads and messages directly. This lets you choose exactly which memories are included in the context window, or fetch messages to render conversation history in your UI.

## Accessing Memory

To access memory functions for querying, cloning, or deleting threads and messages, call `getMemory()` on an agent:

```typescript
const agent = mastra.getAgent("weatherAgent");
const memory = await agent.getMemory();
```

The `Memory` instance gives you access to functions for listing threads, recalling messages, cloning conversations, and more.

## Querying

Use these methods to fetch threads and messages for displaying conversation history in your UI or for custom memory retrieval logic.

> **Warning:** The memory system does not enforce access control. Before running any query, verify in your application logic that the current user is authorized to access the `resourceId` being queried.

### Threads

Use [`listThreads()`](https://mastra.ai/reference/memory/listThreads) to retrieve threads for a resource:

```typescript
const result = await memory.listThreads({
  filter: { resourceId: "user-123" },
  perPage: false,
});
```

Paginate through threads:

```typescript
const result = await memory.listThreads({
  filter: { resourceId: "user-123" },
  page: 0,
  perPage: 10,
});

console.log(result.threads); // thread objects
console.log(result.hasMore); // more pages available?
```

You can also filter by metadata and control sort order:

```typescript
const result = await memory.listThreads({
  filter: {
    resourceId: "user-123",
    metadata: { status: "active" },
  },
  orderBy: { field: "createdAt", direction: "DESC" },
});
```

To fetch a single thread by ID, use [`getThreadById()`](https://mastra.ai/reference/memory/getThreadById):

```typescript
const thread = await memory.getThreadById({ threadId: "thread-123" });
```

### Messages

Once you have a thread, use [`recall()`](https://mastra.ai/reference/memory/recall) to retrieve its messages. It supports pagination, date filtering, and [semantic search](https://mastra.ai/docs/memory/semantic-recall).

Basic recall returns all messages from a thread:

```typescript
const { messages } = await memory.recall({
  threadId: "thread-123",
  perPage: false,
});
```

Paginate through messages:

```typescript
const { messages } = await memory.recall({
  threadId: "thread-123",
  page: 0,
  perPage: 50,
});
```

Filter by date range:

```typescript
const { messages } = await memory.recall({
  threadId: "thread-123",
  filter: {
    dateRange: {
      start: new Date("2025-01-01"),
      end: new Date("2025-06-01"),
    },
  },
});
```

Fetch a single message by ID:

```typescript
const { messages } = await memory.recall({
  threadId: "thread-123",
  include: [{ id: "msg-123" }],
});
```

Fetch multiple messages by ID with surrounding context:

```typescript
const { messages } = await memory.recall({
  threadId: "thread-123",
  include: [
    { id: "msg-123" },
    {
      id: "msg-456",
      withPreviousMessages: 3,
      withNextMessages: 1,
    },
  ],
});
```

Search by meaning (see [Semantic recall](https://mastra.ai/docs/memory/semantic-recall) for setup):

```typescript
const { messages } = await memory.recall({
  threadId: "thread-123",
  vectorSearchString: "project deadline discussion",
  threadConfig: {
    semanticRecall: true,
  },
});
```

### UI format

Message queries return `MastraDBMessage[]` format. To display messages in a frontend, you may need to convert them to a format your UI library expects. For example, [`toAISdkV5Messages`](https://mastra.ai/reference/ai-sdk/to-ai-sdk-v5-messages) converts messages to AI SDK UI format.

## Thread cloning

Thread cloning creates a copy of an existing thread with its messages. This is useful for branching conversations, creating checkpoints before a potentially destructive operation, or testing variations of a conversation.

```typescript
const { thread, clonedMessages } = await memory.cloneThread({
  sourceThreadId: "thread-123",
  title: "Branched conversation",
});
```

You can filter which messages get cloned (by count or date range), specify custom thread IDs, and use utility methods to inspect clone relationships.

See [`cloneThread()`](https://mastra.ai/reference/memory/cloneThread) and [clone utilities](https://mastra.ai/reference/memory/clone-utilities) for the full API.

## Deleting messages

## To remove messages from a thread, use [`deleteMessages()`](https://mastra.ai/reference/memory/deleteMessages). You can delete by message ID or clear all messages from a thread.

# Working Memory

While [message history](https://mastra.ai/docs/memory/message-history) and [semantic recall](https://mastra.ai/docs/memory/semantic-recall) help agents remember conversations, working memory allows them to maintain persistent information about users across interactions.

Think of it as the agent's active thoughts or scratchpad – the key information they keep available about the user or task. It's similar to how a person would naturally remember someone's name, preferences, or important details during a conversation.

This is useful for maintaining ongoing state that's always relevant and should always be available to the agent.

Working memory can persist at two different scopes:

- **Resource-scoped** (default): Memory persists across all conversation threads for the same user
- **Thread-scoped**: Memory is isolated per conversation thread

**Important:** Switching between scopes means the agent won't see memory from the other scope - thread-scoped memory is completely separate from resource-scoped memory.

## Quick Start

Here's a minimal example of setting up an agent with working memory:

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

// Create agent with working memory enabled
const agent = new Agent({
  id: "personal-assistant",
  name: "PersonalAssistant",
  instructions: "You are a helpful personal assistant.",
  model: "openai/gpt-5.1",
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
      },
    },
  }),
});
```

## How it Works

Working memory is a block of Markdown text that the agent is able to update over time to store continuously relevant information:

[YouTube video player](https://www.youtube-nocookie.com/embed/UMy_JHLf1n8)

## Memory Persistence Scopes

Working memory can operate in two different scopes, allowing you to choose how memory persists across conversations:

### Resource-Scoped Memory (Default)

By default, working memory persists across all conversation threads for the same user (resourceId), enabling persistent user memory:

```typescript
const memory = new Memory({
  storage,
  options: {
    workingMemory: {
      enabled: true,
      scope: "resource", // Memory persists across all user threads
      template: `# User Profile
- **Name**:
- **Location**:
- **Interests**:
- **Preferences**:
- **Long-term Goals**:
`,
    },
  },
});
```

**Use cases:**

- Personal assistants that remember user preferences
- Customer service bots that maintain customer context
- Educational applications that track student progress

### Usage with Agents

When using resource-scoped memory, make sure to pass the `resource` parameter in the memory options:

```typescript
// Resource-scoped memory requires resource
const response = await agent.generate("Hello!", {
  memory: {
    thread: "conversation-123",
    resource: "user-alice-456", // Same user across different threads
  },
});
```

### Thread-Scoped Memory

Thread-scoped memory isolates working memory to individual conversation threads. Each thread maintains its own isolated memory:

```typescript
const memory = new Memory({
  storage,
  options: {
    workingMemory: {
      enabled: true,
      scope: "thread", // Memory is isolated per thread
      template: `# User Profile
- **Name**:
- **Interests**:
- **Current Goal**:
`,
    },
  },
});
```

**Use cases:**

- Different conversations about separate topics
- Temporary or session-specific information
- Workflows where each thread needs working memory but threads are ephemeral and not related to each other

## Storage Adapter Support

Resource-scoped working memory requires specific storage adapters that support the `mastra_resources` table:

### Supported Storage Adapters

- **libSQL** (`@mastra/libsql`)
- **PostgreSQL** (`@mastra/pg`)
- **Upstash** (`@mastra/upstash`)
- **MongoDB** (`@mastra/mongodb`)

## Custom Templates

Templates guide the agent on what information to track and update in working memory. While a default template is used if none is provided, you'll typically want to define a custom template tailored to your agent's specific use case to ensure it remembers the most relevant information.

Here's an example of a custom template. In this example the agent will store the users name, location, timezone, etc as soon as the user sends a message containing any of the info:

```typescript
const memory = new Memory({
  options: {
    workingMemory: {
      enabled: true,
      template: `
# User Profile

## Personal Info

- Name:
- Location:
- Timezone:

## Preferences

- Communication Style: [e.g., Formal, Casual]
- Project Goal:
- Key Deadlines:
  - [Deadline 1]: [Date]
  - [Deadline 2]: [Date]

## Session State

- Last Task Discussed:
- Open Questions:
  - [Question 1]
  - [Question 2]
`,
    },
  },
});
```

## Designing Effective Templates

A well-structured template keeps the information easy for the agent to parse and update. Treat the template as a short form that you want the assistant to keep up to date.

- **Short, focused labels.** Avoid paragraphs or very long headings. Keep labels brief (for example `## Personal Info` or `- Name:`) so updates are easy to read and less likely to be truncated.
- **Use consistent casing.** Inconsistent capitalization (`Timezone:` vs `timezone:`) can cause messy updates. Stick to Title Case or lower case for headings and bullet labels.
- **Keep placeholder text simple.** Use hints such as `[e.g., Formal]` or `[Date]` to help the LLM fill in the correct spots.
- **Abbreviate very long values.** If you only need a short form, include guidance like `- Name: [First name or nickname]` or `- Address (short):` rather than the full legal text.
- **Mention update rules in `instructions`.** You can instruct how and when to fill or clear parts of the template directly in the agent's `instructions` field.

### Alternative Template Styles

Use a shorter single block if you only need a few items:

```typescript
const basicMemory = new Memory({
  options: {
    workingMemory: {
      enabled: true,
      template: `User Facts:\n- Name:\n- Favorite Color:\n- Current Topic:`,
    },
  },
});
```

You can also store the key facts in a short paragraph format if you prefer a more narrative style:

```typescript
const paragraphMemory = new Memory({
  options: {
    workingMemory: {
      enabled: true,
      template: `Important Details:\n\nKeep a short paragraph capturing the user's important facts (name, main goal, current task).`,
    },
  },
});
```

## Structured Working Memory

Working memory can also be defined using a structured schema instead of a Markdown template. This allows you to specify the exact fields and types that should be tracked, using a [Zod](https://zod.dev/) schema. When using a schema, the agent will see and update working memory as a JSON object matching your schema.

**Important:** You must specify either `template` or `schema`, but not both.

### Example: Schema-Based Working Memory

```typescript
import { z } from "zod";
import { Memory } from "@mastra/memory";

const userProfileSchema = z.object({
  name: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  preferences: z
    .object({
      communicationStyle: z.string().optional(),
      projectGoal: z.string().optional(),
      deadlines: z.array(z.string()).optional(),
    })
    .optional(),
});

const memory = new Memory({
  options: {
    workingMemory: {
      enabled: true,
      schema: userProfileSchema,
      // template: ... (do not set)
    },
  },
});
```

When a schema is provided, the agent receives the working memory as a JSON object. For example:

```json
{
  "name": "Sam",
  "location": "Berlin",
  "timezone": "CET",
  "preferences": {
    "communicationStyle": "Formal",
    "projectGoal": "Launch MVP",
    "deadlines": ["2025-07-01"]
  }
}
```

### Merge Semantics for Schema-Based Memory

Schema-based working memory uses **merge semantics**, meaning the agent only needs to include fields it wants to add or update. Existing fields are preserved automatically.

- **Object fields are deep merged:** Only provided fields are updated; others remain unchanged
- **Set a field to `null` to delete it:** This explicitly removes the field from memory
- **Arrays are replaced entirely:** When an array field is provided, it replaces the existing array (arrays are not merged element-by-element)

## Choosing Between Template and Schema

- Use a **template** (Markdown) if you want the agent to maintain memory as a free-form text block, such as a user profile or scratchpad. Templates use **replace semantics** — the agent must provide the complete memory content on each update.
- Use a **schema** if you need structured, type-safe data that can be validated and programmatically accessed as JSON. Schemas use **merge semantics** — the agent only provides fields to update, and existing fields are preserved.
- Only one mode can be active at a time: setting both `template` and `schema` is not supported.

## Example: Multi-step Retention

Below is a simplified view of how the `User Profile` template updates across a short user conversation:

```nohighlight
# User Profile

## Personal Info

- Name:
- Location:
- Timezone:

--- After user says "My name is **Sam** and I'm from **Berlin**" ---

# User Profile
- Name: Sam
- Location: Berlin
- Timezone:

--- After user adds "By the way I'm normally in **CET**" ---

# User Profile
- Name: Sam
- Location: Berlin
- Timezone: CET
```

The agent can now refer to `Sam` or `Berlin` in later responses without requesting the information again because it has been stored in working memory.

If your agent is not properly updating working memory when you expect it to, you can add system instructions on _how_ and _when_ to use this template in your agent's `instructions` setting.

## Setting Initial Working Memory

While agents typically update working memory through the `updateWorkingMemory` tool, you can also set initial working memory programmatically when creating or updating threads. This is useful for injecting user data (like their name, preferences, or other info) that you want available to the agent without passing it in every request.

### Setting Working Memory via Thread Metadata

When creating a thread, you can provide initial working memory through the metadata's `workingMemory` key:

```typescript
// Create a thread with initial working memory
const thread = await memory.createThread({
  threadId: "thread-123",
  resourceId: "user-456",
  title: "Medical Consultation",
  metadata: {
    workingMemory: `# Patient Profile
- Name: John Doe
- Blood Type: O+
- Allergies: Penicillin
- Current Medications: None
- Medical History: Hypertension (controlled)
`,
  },
});

// The agent will now have access to this information in all messages
await agent.generate("What's my blood type?", {
  memory: {
    thread: thread.id,
    resource: "user-456",
  },
});
// Response: "Your blood type is O+."
```

### Updating Working Memory Programmatically

You can also update an existing thread's working memory:

```typescript
// Update thread metadata to add/modify working memory
await memory.updateThread({
  id: "thread-123",
  title: thread.title,
  metadata: {
    ...thread.metadata,
    workingMemory: `# Patient Profile
- Name: John Doe
- Blood Type: O+
- Allergies: Penicillin, Ibuprofen  // Updated
- Current Medications: Lisinopril 10mg daily  // Added
- Medical History: Hypertension (controlled)
`,
  },
});
```

### Direct Memory Update

Alternatively, use the `updateWorkingMemory` method directly:

```typescript
await memory.updateWorkingMemory({
  threadId: "thread-123",
  resourceId: "user-456", // Required for resource-scoped memory
  workingMemory: "Updated memory content...",
});
```

## Read-Only Working Memory

In some scenarios, you may want an agent to have access to working memory data without the ability to modify it. This is useful for:

- **Routing agents** that need context but shouldn't update user profiles
- **Sub agents** in a multi-agent system that should reference but not own the memory

To enable read-only mode, set `readOnly: true` in the memory options:

```typescript
const response = await agent.generate("What do you know about me?", {
  memory: {
    thread: "conversation-123",
    resource: "user-alice-456",
    options: {
      readOnly: true, // Working memory is provided but cannot be updated
    },
  },
});
```

## Examples

- [Working memory with template](https://github.com/mastra-ai/mastra/tree/main/examples/memory-with-template)
- [Working memory with schema](https://github.com/mastra-ai/mastra/tree/main/examples/memory-with-schema)
- [Per-resource working memory](https://github.com/mastra-ai/mastra/tree/main/examples/memory-per-resource-example) - Complete example showing resource-scoped memory persistence

---

# Semantic Recall

If you ask your friend what they did last weekend, they will search in their memory for events associated with "last weekend" and then tell you what they did. That's sort of like how semantic recall works in Mastra.

> **Watch 📹:** What semantic recall is, how it works, and how to configure it in Mastra → [YouTube (5 minutes)](https://youtu.be/UVZtK8cK8xQ)

## How Semantic Recall Works

Semantic recall is RAG-based search that helps agents maintain context across longer interactions when messages are no longer within [recent message history](https://mastra.ai/docs/memory/message-history).

It uses vector embeddings of messages for similarity search, integrates with various vector stores, and has configurable context windows around retrieved messages.

![Diagram showing Mastra Memory semantic recall](/assets/images/semantic-recall-fd7b9336a6d0d18019216cb6d3dbe710.png)

When it's enabled, new messages are used to query a vector DB for semantically similar messages.

After getting a response from the LLM, all new messages (user, assistant, and tool calls/results) are inserted into the vector DB to be recalled in later interactions.

## Quick Start

Semantic recall is enabled by default, so if you give your agent memory it will be included:

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

const agent = new Agent({
  id: "support-agent",
  name: "SupportAgent",
  instructions: "You are a helpful support agent.",
  model: "openai/gpt-5.1",
  memory: new Memory(),
});
```

## Using the recall() Method

While `listMessages` retrieves messages by thread ID with basic pagination, [`recall()`](https://mastra.ai/reference/memory/recall) adds support for **semantic search**. When you need to find messages by meaning rather than just recency, use `recall()` with a `vectorSearchString`:

```typescript
const memory = await agent.getMemory();

// Basic recall - similar to listMessages
const { messages } = await memory!.recall({
  threadId: "thread-123",
  perPage: 50,
});

// Semantic recall - find messages by meaning
const { messages: relevantMessages } = await memory!.recall({
  threadId: "thread-123",
  vectorSearchString: "What did we discuss about the project deadline?",
  threadConfig: {
    semanticRecall: true,
  },
});
```

## Storage configuration

Semantic recall relies on a [storage and vector db](https://mastra.ai/reference/memory/memory-class) to store messages and their embeddings.

```ts
import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";

const agent = new Agent({
  memory: new Memory({
    // this is the default storage db if omitted
    storage: new LibSQLStore({
      id: "agent-storage",
      url: "file:./local.db",
    }),
    // this is the default vector db if omitted
    vector: new LibSQLVector({
      id: "agent-vector",
      url: "file:./local.db",
    }),
  }),
});
```

Each vector store page below includes installation instructions, configuration parameters, and usage examples:

- [Astra](https://mastra.ai/reference/vectors/astra)
- [Chroma](https://mastra.ai/reference/vectors/chroma)
- [Cloudflare Vectorize](https://mastra.ai/reference/vectors/vectorize)
- [Convex](https://mastra.ai/reference/vectors/convex)
- [Couchbase](https://mastra.ai/reference/vectors/couchbase)
- [DuckDB](https://mastra.ai/reference/vectors/duckdb)
- [Elasticsearch](https://mastra.ai/reference/vectors/elasticsearch)
- [LanceDB](https://mastra.ai/reference/vectors/lance)
- [libSQL](https://mastra.ai/reference/vectors/libsql)
- [MongoDB](https://mastra.ai/reference/vectors/mongodb)
- [OpenSearch](https://mastra.ai/reference/vectors/opensearch)
- [Pinecone](https://mastra.ai/reference/vectors/pinecone)
- [PostgreSQL](https://mastra.ai/reference/vectors/pg)
- [Qdrant](https://mastra.ai/reference/vectors/qdrant)
- [S3 Vectors](https://mastra.ai/reference/vectors/s3vectors)
- [Turbopuffer](https://mastra.ai/reference/vectors/turbopuffer)
- [Upstash](https://mastra.ai/reference/vectors/upstash)

## Recall configuration

The three main parameters that control semantic recall behavior are:

1. **topK**: How many semantically similar messages to retrieve
2. **messageRange**: How much surrounding context to include with each match
3. **scope**: Whether to search within the current thread or across all threads owned by a resource (the default is resource scope).

```typescript
const agent = new Agent({
  memory: new Memory({
    options: {
      semanticRecall: {
        topK: 3, // Retrieve 3 most similar messages
        messageRange: 2, // Include 2 messages before and after each match
        scope: "resource", // Search across all threads for this user (default setting if omitted)
      },
    },
  }),
});
```

## Embedder configuration

Semantic recall relies on an [embedding model](https://mastra.ai/reference/memory/memory-class) to convert messages into embeddings. Mastra supports embedding models through the model router using `provider/model` strings, or you can use any [embedding model](https://sdk.vercel.ai/docs/ai-sdk-core/embeddings) compatible with the AI SDK.

#### Using the Model Router (Recommended)

The simplest way is to use a `provider/model` string with autocomplete support:

```ts
import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";

const agent = new Agent({
  memory: new Memory({
    embedder: new ModelRouterEmbeddingModel("openai/text-embedding-3-small"),
  }),
});
```

Supported embedding models:

- **OpenAI**: `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002`
- **Google**: `gemini-embedding-001`

The model router automatically handles API key detection from environment variables (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`).

#### Using AI SDK Packages

You can also use AI SDK embedding models directly:

```ts
import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";

const agent = new Agent({
  memory: new Memory({
    embedder: new ModelRouterEmbeddingModel("openai/text-embedding-3-small"),
  }),
});
```

#### Using FastEmbed (Local)

To use FastEmbed (a local embedding model), install `@mastra/fastembed`:

**npm**:

```bash
npm install @mastra/fastembed@latest
```

**pnpm**:

```bash
pnpm add @mastra/fastembed@latest
```

**Yarn**:

```bash
yarn add @mastra/fastembed@latest
```

**Bun**:

```bash
bun add @mastra/fastembed@latest
```

Then configure it in your memory:

```ts
import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";
import { fastembed } from "@mastra/fastembed";

const agent = new Agent({
  memory: new Memory({
    embedder: fastembed,
  }),
});
```

## PostgreSQL Index Optimization

When using PostgreSQL as your vector store, you can optimize semantic recall performance by configuring the vector index. This is particularly important for large-scale deployments with thousands of messages.

PostgreSQL supports both IVFFlat and HNSW indexes. By default, Mastra creates an IVFFlat index, but HNSW indexes typically provide better performance, especially with OpenAI embeddings which use inner product distance.

```typescript
import { Memory } from "@mastra/memory";
import { PgStore, PgVector } from "@mastra/pg";

const agent = new Agent({
  memory: new Memory({
    storage: new PgStore({
      id: "agent-storage",
      connectionString: process.env.DATABASE_URL,
    }),
    vector: new PgVector({
      id: "agent-vector",
      connectionString: process.env.DATABASE_URL,
    }),
    options: {
      semanticRecall: {
        topK: 5,
        messageRange: 2,
        indexConfig: {
          type: "hnsw", // Use HNSW for better performance
          metric: "dotproduct", // Best for OpenAI embeddings
          m: 16, // Number of bi-directional links (default: 16)
          efConstruction: 64, // Size of candidate list during construction (default: 64)
        },
      },
    },
  }),
});
```

For detailed information about index configuration options and performance tuning, see the [PgVector configuration guide](https://mastra.ai/reference/vectors/pg).

## Disabling

There is a performance impact to using semantic recall. New messages are converted into embeddings and used to query a vector database before new messages are sent to the LLM.

Semantic recall is enabled by default but can be disabled when not needed:

```typescript
const agent = new Agent({
  memory: new Memory({
    options: {
      semanticRecall: false,
    },
  }),
});
```

You might want to disable semantic recall in scenarios like:

- When message history provides sufficient context for the current conversation.
- In performance-sensitive applications, like realtime two-way audio, where the added latency of creating embeddings and running vector queries is noticeable.

## Viewing Recalled Messages

## When tracing is enabled, any messages retrieved via semantic recall will appear in the agent's trace output, alongside recent message history (if configured).

# Memory Processors

Memory processors transform and filter messages as they pass through an agent with memory enabled. They manage context window limits, remove unnecessary content, and optimize the information sent to the language model.

When memory is enabled on an agent, Mastra adds memory processors to the agent's processor pipeline. These processors retrieve message history, working memory, and semantically relevant messages, then persist new messages after the model responds.

Memory processors are [processors](https://mastra.ai/docs/agents/processors) that operate specifically on memory-related messages and state.

## Built-in Memory Processors

Mastra automatically adds these processors when memory is enabled:

### MessageHistory

Retrieves message history and persists new messages.

**When you configure:**

```typescript
memory: new Memory({
  lastMessages: 10,
});
```

**Mastra internally:**

1. Creates a `MessageHistory` processor with `limit: 10`
2. Adds it to the agent's input processors (runs before the LLM)
3. Adds it to the agent's output processors (runs after the LLM)

**What it does:**

- **Input**: Fetches the last 10 messages from storage and prepends them to the conversation
- **Output**: Persists new messages to storage after the model responds

**Example:**

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  id: "test-agent",
  name: "Test Agent",
  instructions: "You are a helpful assistant",
  model: "openai/gpt-4o",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "memory-store",
      url: "file:memory.db",
    }),
    lastMessages: 10, // MessageHistory processor automatically added
  }),
});
```

### SemanticRecall

Retrieves semantically relevant messages based on the current input and creates embeddings for new messages.

**When you configure:**

```typescript
memory: new Memory({
  semanticRecall: { enabled: true },
  vector: myVectorStore,
  embedder: myEmbedder,
});
```

**Mastra internally:**

1. Creates a `SemanticRecall` processor
2. Adds it to the agent's input processors (runs before the LLM)
3. Adds it to the agent's output processors (runs after the LLM)
4. Requires both a vector store and embedder to be configured

**What it does:**

- **Input**: Performs vector similarity search to find relevant past messages and prepends them to the conversation
- **Output**: Creates embeddings for new messages and stores them in the vector store for future retrieval

**Example:**

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { PineconeVector } from "@mastra/pinecone";
import { OpenAIEmbedder } from "@mastra/openai";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  name: "semantic-agent",
  instructions: "You are a helpful assistant with semantic memory",
  model: "openai/gpt-4o",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "memory-store",
      url: "file:memory.db",
    }),
    vector: new PineconeVector({
      id: "memory-vector",
      apiKey: process.env.PINECONE_API_KEY!,
    }),
    embedder: new OpenAIEmbedder({
      model: "text-embedding-3-small",
      apiKey: process.env.OPENAI_API_KEY!,
    }),
    semanticRecall: { enabled: true }, // SemanticRecall processor automatically added
  }),
});
```

### WorkingMemory

Manages working memory state across conversations.

**When you configure:**

```typescript
memory: new Memory({
  workingMemory: { enabled: true },
});
```

**Mastra internally:**

1. Creates a `WorkingMemory` processor
2. Adds it to the agent's input processors (runs before the LLM)
3. Requires a storage adapter to be configured

**What it does:**

- **Input**: Retrieves working memory state for the current thread and prepends it to the conversation
- **Output**: No output processing

**Example:**

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  name: "working-memory-agent",
  instructions: "You are an assistant with working memory",
  model: "openai/gpt-4o",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "memory-store",
      url: "file:memory.db",
    }),
    workingMemory: { enabled: true }, // WorkingMemory processor automatically added
  }),
});
```

## Manual Control and Deduplication

If you manually add a memory processor to `inputProcessors` or `outputProcessors`, Mastra will **not** automatically add it. This gives you full control over processor ordering:

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { MessageHistory } from "@mastra/core/processors";
import { TokenLimiter } from "@mastra/core/processors";
import { LibSQLStore } from "@mastra/libsql";
import { openai } from "@ai-sdk/openai";

// Custom MessageHistory with different configuration
const customMessageHistory = new MessageHistory({
  storage: new LibSQLStore({ id: "memory-store", url: "file:memory.db" }),
  lastMessages: 20,
});

const agent = new Agent({
  name: "custom-memory-agent",
  instructions: "You are a helpful assistant",
  model: "openai/gpt-4o",
  memory: new Memory({
    storage: new LibSQLStore({ id: "memory-store", url: "file:memory.db" }),
    lastMessages: 10, // This would normally add MessageHistory(10)
  }),
  inputProcessors: [
    customMessageHistory, // Your custom one is used instead
    new TokenLimiter({ limit: 4000 }), // Runs after your custom MessageHistory
  ],
});
```

## Processor Execution Order

Understanding the execution order is important when combining guardrails with memory:

### Input Processors

```text
[Memory Processors] → [Your inputProcessors]
```

1. **Memory processors run FIRST**: `WorkingMemory`, `MessageHistory`, `SemanticRecall`
2. **Your input processors run AFTER**: guardrails, filters, validators

This means memory loads message history before your processors can validate or filter the input.

### Output Processors

```text
[Your outputProcessors] → [Memory Processors]
```

1. **Your output processors run FIRST**: guardrails, filters, validators
2. **Memory processors run AFTER**: `SemanticRecall` (embeddings), `MessageHistory` (persistence)

This ordering is designed to be **safe by default**: if your output guardrail calls `abort()`, the memory processors never run and **no messages are saved**.

## Guardrails and Memory

The default execution order provides safe guardrail behavior:

### Output guardrails (recommended)

Output guardrails run **before** memory processors save messages. If a guardrail aborts:

- The tripwire is triggered
- Memory processors are skipped
- **No messages are persisted to storage**

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { openai } from "@ai-sdk/openai";

// Output guardrail that blocks inappropriate content
const contentBlocker = {
  id: "content-blocker",
  processOutputResult: async ({ messages, abort }) => {
    const hasInappropriateContent = messages.some(msg => containsBadContent(msg));
    if (hasInappropriateContent) {
      abort("Content blocked by guardrail");
    }
    return messages;
  },
};

const agent = new Agent({
  name: "safe-agent",
  instructions: "You are a helpful assistant",
  model: "openai/gpt-4o",
  memory: new Memory({ lastMessages: 10 }),
  // Your guardrail runs BEFORE memory saves
  outputProcessors: [contentBlocker],
});

// If the guardrail aborts, nothing is saved to memory
const result = await agent.generate("Hello");
if (result.tripwire) {
  console.log("Blocked:", result.tripwire.reason);
  // Memory is empty - no messages were persisted
}
```

### Input guardrails

Input guardrails run **after** memory processors load history. If a guardrail aborts:

- The tripwire is triggered
- The LLM is never called
- Output processors (including memory persistence) are skipped
- **No messages are persisted to storage**

```typescript
// Input guardrail that validates user input
const inputValidator = {
  id: "input-validator",
  processInput: async ({ messages, abort }) => {
    const lastUserMessage = messages.findLast(m => m.role === "user");
    if (isInvalidInput(lastUserMessage)) {
      abort("Invalid input detected");
    }
    return messages;
  },
};

const agent = new Agent({
  name: "validated-agent",
  instructions: "You are a helpful assistant",
  model: "openai/gpt-4o",
  memory: new Memory({ lastMessages: 10 }),
  // Your guardrail runs AFTER memory loads history
  inputProcessors: [inputValidator],
});
```

### Summary

| Guardrail Type | When it runs               | If it aborts                  |
| -------------- | -------------------------- | ----------------------------- |
| Input          | After memory loads history | LLM not called, nothing saved |
| Output         | Before memory saves        | Nothing saved to storage      |

Both scenarios are safe - guardrails prevent inappropriate content from being persisted to memory

## Related documentation

- [Processors](https://mastra.ai/docs/agents/processors) - General processor concepts and custom processor creation
- [Guardrails](https://mastra.ai/docs/agents/guardrails) - Security and validation processors
- [Memory Overview](https://mastra.ai/docs/memory/overview) - Memory types and configuration

When creating custom processors avoid mutating the input `messages` array or its objects directly.
