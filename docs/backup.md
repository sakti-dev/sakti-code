Desktop-Agent Integration via Hono Server
Comprehensive plan for integrating the SolidJS desktop UI (apps/desktop) with the AI agent system (packages/core) through the Hono REST API server (packages/server).

Based on research from: .claude/research/plans/new-solid-ai-integration.md

Background
The ekacode project has a three-tier architecture:

Electron App (Desktop) - SolidJS renderer process for UI
Hono REST API (Server) - HTTP endpoints for chat, events, permissions
Core Logic (Core) - AI agents, workflow engine, tools, and session management
Currently, the desktop UI has mock implementations in workspace-view/index.tsx that need to be replaced with real API integration using Vercel AI SDK's native UIMessage stream protocol.

Critical Design Principles
IMPORTANT

Use AI SDK's Native Protocol - No custom SSE event types. Use data-\* parts for custom state (RLM phases, progress).

IMPORTANT

Use createStore + produce for High-Frequency Updates - O(1) per token updates instead of O(N) array reconciliation. Critical for 50-100 tokens/sec streaming.

IMPORTANT

Render message.parts, Not message.content - Parts array contains text, tool calls, tool results, and custom data parts.

WARNING

No Dependency Arrays in Solid - Solid.js does not have React-style dependency arrays in createMemo/createEffect.

WARNING

Sanitize at Network Boundary Only - Use Solid's unwrap() to remove proxies when sending to server, not structuredClone on every update.

Proposed Changes
Phase 1: Type Definitions & API Client
[NEW]
types/ui-message.ts
Extended UIMessage type with custom data parts for RLM state, progress, and permissions.

import type { UIMessage } from "ai";
/\*\*

- Extended UI message with custom data parts
  \*/
  export type ChatUIMessage = UIMessage<
  never, // No reasoning parts
  {
  "data-rlm-state": RLMStateData;
  "data-progress": ProgressData;
  "data-permission": PermissionRequestData;
  "data-session": SessionData;
  }
  > ;
  > export interface RLMStateData {
  > value: unknown; // XState machine value
  > phase?: "explore" | "plan" | "build" | "completed" | "failed";
  > step?: string; // Current step within phase
  > progress?: number; // 0-1 progress indicator
  > activeAgents?: string[]; // Currently running agents
  > }
  > export interface ProgressData {
  > operation: string;
  > current: number;
  > total: number;
  > message?: string;
  > }
  > export interface PermissionRequestData {
  > id: string;
  > toolName: string;
  > args: Record<string, unknown>;
  > sessionID: string;
  > }
  > export interface SessionData {
  > sessionId: string;
  > resourceId: string;
  > threadId: string;
  > createdAt: string;
  > lastAccessed: string;
  > }
  > export interface ChatState {
  > messages: ChatUIMessage[];
  > status: "idle" | "connecting" | "streaming" | "processing" | "done" | "error";
  > error: Error | null;
  > rlmState: RLMStateData | null;
  > sessionId: string | null;
  > }
  > [NEW]
  > lib/api-client.ts
  > Typed API client using preload server config.

interface ApiClientConfig {
baseUrl: string;
token: string;
}
export class EkacodeApiClient {
private config: ApiClientConfig;

constructor(config: ApiClientConfig) {
this.config = config;
}
private authHeader(): string {
return `Basic ${btoa(`admin:${this.config.token}`)}`;
}
// Chat API - returns Response for streaming
async chat(
messages: ChatUIMessage[],
options: {
sessionId?: string;
workspace: string;
signal?: AbortSignal;
}
): Promise<Response> {
const headers: Record<string, string> = {
"Content-Type": "application/json",
"Authorization": this.authHeader(),
};

    if (options.sessionId) {
      headers["X-Session-ID"] = options.sessionId;
    }
    return fetch(`${this.config.baseUrl}/api/chat?directory=${encodeURIComponent(options.workspace)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages, stream: true }),
      signal: options.signal,
    });

}
// Permissions API
async approvePermission(id: string, approved: boolean, patterns?: string[]): Promise<void> {
await fetch(`${this.config.baseUrl}/api/permissions/approve`, {
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization": this.authHeader(),
},
body: JSON.stringify({ id, approved, patterns }),
});
}
// Events SSE connection
connectToEvents(workspace: string, sessionId?: string): EventSource {
const url = new URL(`${this.config.baseUrl}/api/events`);
url.searchParams.set("directory", workspace);
if (sessionId) {
url.searchParams.set("sessionId", sessionId);
}
return new EventSource(url.toString());
}
}
Phase 2: Solid Store & Stream Parser
[NEW]
lib/chat/store.ts
Critical for Performance: Uses createStore + produce for O(1) updates.

import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { ChatUIMessage, ChatState, RLMStateData } from "../../types/ui-message";
export function createChatStore(initialMessages: ChatUIMessage[] = []) {
const [store, setStore] = createStore<ChatState>({
messages: initialMessages,
status: "idle",
error: null,
rlmState: null,
sessionId: null,
});
return {
get: () => store,
// Add a new message (user or initial assistant)
addMessage(message: ChatUIMessage) {
setStore("messages", messages => [...messages, structuredClone(message)]);
},
// O(1) update using produce - critical for streaming
updateMessage(messageId: string, updater: (message: ChatUIMessage) => void) {
setStore("messages", m => m.id === messageId, produce(updater));
},
// Append text delta - O(1) per token
appendTextDelta(messageId: string, delta: string) {
setStore(
"messages",
m => m.id === messageId,
produce(message => {
const textPart = message.parts.find(p => p.type === "text");
if (textPart && textPart.type === "text") {
textPart.text += delta;
}
})
);
},
// Add tool call part
addToolCall(messageId: string, toolCall: { toolCallId: string; toolName: string; args: unknown }) {
setStore(
"messages",
m => m.id === messageId,
produce(message => {
message.parts.push({
type: "tool-call",
...toolCall,
});
})
);
},
// Update tool call args (for streaming)
updateToolCall(messageId: string, toolCallId: string, args: unknown) {
setStore(
"messages",
m => m.id === messageId,
produce(message => {
const part = message.parts.find(
p => p.type === "tool-call" && p.toolCallId === toolCallId
);
if (part && part.type === "tool-call") {
part.args = args;
}
})
);
},
// Add tool result
addToolResult(messageId: string, toolResult: { toolCallId: string; result: unknown }) {
setStore(
"messages",
m => m.id === messageId,
produce(message => {
message.parts.push({
type: "tool-result",
...toolResult,
});
})
);
},
// Replace all messages (for history load)
setMessages(messages: ChatUIMessage[]) {
setStore("messages", reconcile(messages, { key: "id" }));
},
setStatus(status: ChatState["status"]) {
setStore("status", status);
},
setError(error: Error | null) {
setStore("error", error);
},
setRLMState(state: RLMStateData | null) {
setStore("rlmState", state);
},
setSessionId(sessionId: string | null) {
setStore("sessionId", sessionId);
},
// Get plain messages for network (removes Solid proxies)
getMessagesForNetwork(): ChatUIMessage[] {
return unwrap(store.messages);
},
};
}
export type ChatStore = ReturnType<typeof createChatStore>;
[NEW]
lib/chat/stream-parser.ts
Parse AI SDK UIMessage stream protocol (not custom SSE).

export interface StreamCallbacks {
onMessageStart: (messageId: string) => void;
onTextDelta: (messageId: string, delta: string) => void;
onToolCallStart: (toolCall: { toolCallId: string; toolName: string }) => void;
onToolCallDelta: (toolCallId: string, argsTextDelta: string) => void;
onToolCallEnd: (toolCallId: string, args: unknown) => void;
onToolResult: (result: { toolCallId: string; result: unknown }) => void;
onDataPart: (type: string, id: string, data: unknown) => void;
onError: (error: Error) => void;
onComplete: (finishReason: string) => void;
}
export async function parseUIMessageStream(
response: Response,
callbacks: Partial<StreamCallbacks>
): Promise<void> {
if (!response.body) {
throw new Error("Response body is null");
}
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let currentMessageId: string | null = null;
const toolArgsBuffers = new Map<string, string>();
while (true) {
const { done, value } = await reader.read();
if (done) {
callbacks.onComplete?.("stop");
break;
}
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() ?? "";
for (const line of lines) {
if (!line.trim()) continue;
// Handle SSE data format
if (line.startsWith("data: ")) {
const data = line.slice(6).trim();
if (data === "[DONE]") {
callbacks.onComplete?.("stop");
continue;
}
try {
const part = JSON.parse(data);
handleStreamPart(part, callbacks, currentMessageId, toolArgsBuffers, (id) => {
currentMessageId = id;
});
} catch (e) {
// Non-JSON data, try raw line parsing
tryParseRawLine(line, callbacks);
}
} else {
// Raw protocol line (0:text, b:json, etc.)
tryParseRawLine(line, callbacks);
}
}
}
}
function handleStreamPart(
part: Record<string, unknown>,
callbacks: Partial<StreamCallbacks>,
currentMessageId: string | null,
toolArgsBuffers: Map<string, string>,
setMessageId: (id: string) => void
): void {
const type = part.type as string;
const id = part.id as string;
switch (type) {
case "message-start":
setMessageId(id);
callbacks.onMessageStart?.(id);
break;
case "text-delta":
callbacks.onTextDelta?.(id || currentMessageId || "", part.delta as string);
break;
case "tool-input-start":
callbacks.onToolCallStart?.({
toolCallId: part.toolCallId as string,
toolName: part.toolName as string,
});
toolArgsBuffers.set(part.toolCallId as string, "");
break;
case "tool-input-delta":
const currentArgs = toolArgsBuffers.get(part.toolCallId as string) ?? "";
toolArgsBuffers.set(part.toolCallId as string, currentArgs + (part.delta as string));
callbacks.onToolCallDelta?.(part.toolCallId as string, part.delta as string);
break;
case "tool-input-end":
const finalArgs = toolArgsBuffers.get(part.toolCallId as string) ?? "{}";
try {
const parsedArgs = JSON.parse(finalArgs);
callbacks.onToolCallEnd?.(part.toolCallId as string, parsedArgs);
} catch {
callbacks.onToolCallEnd?.(part.toolCallId as string, {});
}
toolArgsBuffers.delete(part.toolCallId as string);
break;
case "tool-call":
callbacks.onToolCallStart?.({
toolCallId: part.toolCallId as string,
toolName: part.toolName as string,
});
callbacks.onToolCallEnd?.(part.toolCallId as string, part.args);
break;
case "tool-result":
callbacks.onToolResult?.({
toolCallId: part.toolCallId as string,
result: part.result,
});
break;
case "error":
callbacks.onError?.(new Error(part.error as string));
break;
case "finish":
callbacks.onComplete?.(part.finishReason as string || "stop");
break;
default:
// Handle data-\* parts (RLM state, progress, etc.)
if (type?.startsWith("data-")) {
callbacks.onDataPart?.(type, id, part.data);
}
}
}
function tryParseRawLine(line: string, callbacks: Partial<StreamCallbacks>): void {
// Handle AI SDK protocol lines like "0:text" or "b:{json}"
if (line.startsWith("0:")) {
callbacks.onTextDelta?.("", line.slice(2));
} else if (line.startsWith("d:")) {
try {
const data = JSON.parse(line.slice(2));
callbacks.onComplete?.(data.finishReason || "stop");
} catch {
// Ignore parse errors
}
}
}
Phase 3: useChat Hook
[NEW]
hooks/use-chat.ts
Main chat hook with correct Solid.js primitives.

import { createMemo, onCleanup, type Accessor } from "solid-js";
import { createChatStore, type ChatStore } from "../lib/chat/store";
import { parseUIMessageStream } from "../lib/chat/stream-parser";
import type { ChatUIMessage, ChatState, RLMStateData } from "../types/ui-message";
import { EkacodeApiClient } from "../lib/api-client";
interface UseChatOptions {
client: EkacodeApiClient;
workspace: Accessor<string>;
initialMessages?: ChatUIMessage[];
onError?: (error: Error) => void;
onFinish?: (message: ChatUIMessage) => void;
onRLMStateChange?: (state: RLMStateData) => void;
}
interface UseChatResult {
store: ChatState;
messages: ChatUIMessage[];
status: Accessor<ChatState["status"]>;
error: Accessor<Error | null>;
isLoading: Accessor<boolean>;
canSend: Accessor<boolean>;
rlmState: Accessor<RLMStateData | null>;
sessionId: Accessor<string | null>;

sendMessage: (text: string) => Promise<void>;
stop: () => void;
clearMessages: () => void;
}
export function useChat(options: UseChatOptions): UseChatResult {
const { client, workspace, initialMessages = [], onError, onFinish, onRLMStateChange } = options;
const chatStore = createChatStore(initialMessages);
let abortController: AbortController | null = null;
let currentMessageId: string | null = null;
// Cleanup on unmount
onCleanup(() => {
abortController?.abort();
});
const sendMessage = async (text: string) => {
// Abort any existing request
abortController?.abort();
abortController = new AbortController();
// Add user message
const userMessage: ChatUIMessage = {
id: `msg_${Date.now()}`,
role: "user",
parts: [{ type: "text", text }],
createdAt: new Date(),
};
chatStore.addMessage(userMessage);
// Create assistant message placeholder
currentMessageId = `msg_${Date.now() + 1}`;
const assistantMessage: ChatUIMessage = {
id: currentMessageId,
role: "assistant",
parts: [{ type: "text", text: "" }],
createdAt: new Date(),
};
chatStore.addMessage(assistantMessage);
chatStore.setStatus("connecting");
try {
const response = await client.chat(
chatStore.getMessagesForNetwork(),
{
sessionId: chatStore.get().sessionId ?? undefined,
workspace: workspace(),
signal: abortController.signal,
}
);
if (!response.ok) {
throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}
// Check for session ID in response header
const newSessionId = response.headers.get("X-Session-ID");
if (newSessionId && newSessionId !== chatStore.get().sessionId) {
chatStore.setSessionId(newSessionId);
}
chatStore.setStatus("streaming");
await parseUIMessageStream(response, {
onTextDelta: (messageId, delta) => {
chatStore.appendTextDelta(messageId || currentMessageId!, delta);
},
onToolCallStart: (toolCall) => {
chatStore.addToolCall(currentMessageId!, {
toolCallId: toolCall.toolCallId,
toolName: toolCall.toolName,
args: {},
});
},
onToolCallEnd: (toolCallId, args) => {
chatStore.updateToolCall(currentMessageId!, toolCallId, args);
},
onToolResult: (result) => {
chatStore.addToolResult(currentMessageId!, result);
},
onDataPart: (type, id, data) => {
if (type === "data-rlm-state") {
const rlmState = data as RLMStateData;
chatStore.setRLMState(rlmState);
onRLMStateChange?.(rlmState);
} else if (type === "data-session") {
const sessionData = data as { sessionId: string };
chatStore.setSessionId(sessionData.sessionId);
}
},
onError: (error) => {
chatStore.setStatus("error");
chatStore.setError(error);
onError?.(error);
},
onComplete: () => {
chatStore.setStatus("done");
chatStore.setRLMState(null);
const messages = chatStore.get().messages;
const lastMessage = messages[messages.length - 1];
if (lastMessage) {
onFinish?.(lastMessage);
}
},
});
} catch (error) {
if ((error as Error).name !== "AbortError") {
chatStore.setStatus("error");
chatStore.setError(error as Error);
onError?.(error as Error);
}
} finally {
abortController = null;
currentMessageId = null;
}
};
const stop = () => {
abortController?.abort();
abortController = null;
chatStore.setStatus("idle");
};
const clearMessages = () => {
chatStore.setMessages([]);
chatStore.setStatus("idle");
chatStore.setError(null);
};
// Computed accessors
const status = () => chatStore.get().status;
const error = () => chatStore.get().error;
const isLoading = createMemo(() => {
const s = status();
return s === "connecting" || s === "streaming" || s === "processing";
});
const canSend = createMemo(() => {
const s = status();
return s === "idle" || s === "done" || s === "error";
});
const rlmState = () => chatStore.get().rlmState;
const sessionId = () => chatStore.get().sessionId;
return {
store: chatStore.get(),
messages: chatStore.get().messages,
status,
error,
isLoading,
canSend,
rlmState,
sessionId,
sendMessage,
stop,
clearMessages,
};
}
Phase 4: Message Components (Parts-Based Rendering)
[NEW]
components/message-parts.tsx
Render individual message parts correctly.

import { For, Show, Switch, Match } from "solid-js";
import type { MessagePart } from "ai";
import { cn } from "../lib/utils";
interface MessagePartsProps {
parts: MessagePart[];
class?: string;
}
export function MessageParts(props: MessagePartsProps) {
return (

<div class={cn("message-parts space-y-2", props.class)}>
<For each={props.parts}>
{(part) => (
<Switch fallback={<UnknownPart part={part} />}>
<Match when={part.type === "text"}>
<TextPart part={part as { type: "text"; text: string }} />
</Match>
<Match when={part.type === "tool-call"}>
<ToolCallPart part={part as ToolCallPartData} />
</Match>
<Match when={part.type === "tool-result"}>
<ToolResultPart part={part as ToolResultPartData} />
</Match>
</Switch>
)}
</For>
</div>
);
}
function TextPart(props: { part: { type: "text"; text: string } }) {
return (
<div class="text-part whitespace-pre-wrap">
{props.part.text}
</div>
);
}
interface ToolCallPartData {
type: "tool-call";
toolCallId: string;
toolName: string;
args?: Record<string, unknown>;
}
function ToolCallPart(props: { part: ToolCallPartData }) {
return (
<div class="tool-call border-l-4 border-primary/50 pl-4 my-2 py-2 bg-card/30 rounded-r-lg">
<div class="flex items-center gap-2 mb-2">
<span class="text-xs font-mono px-2 py-0.5 bg-primary/10 rounded">
{props.part.toolName}
</span>
<span class="text-xs text-muted-foreground">
executing...
</span>
</div>
<Show when={props.part.args && Object.keys(props.part.args).length > 0}>
<pre class="text-xs bg-muted/50 p-2 rounded overflow-x-auto">
{JSON.stringify(props.part.args, null, 2)}
</pre>
</Show>
</div>
);
}
interface ToolResultPartData {
type: "tool-result";
toolCallId: string;
result?: unknown;
error?: string;
}
function ToolResultPart(props: { part: ToolResultPartData }) {
return (
<div class="tool-result border-l-4 border-green-500/50 pl-4 my-2 py-2 bg-green-500/5 rounded-r-lg">
<Show when={props.part.error}>
<div class="text-red-500 text-sm">
Error: {props.part.error}
</div>
</Show>
<Show when={props.part.result && !props.part.error}>
<pre class="text-xs bg-green-500/10 p-2 rounded overflow-x-auto max-h-40">
{typeof props.part.result === "string"
? props.part.result
: JSON.stringify(props.part.result, null, 2)}
</pre>
</Show>
</div>
);
}
function UnknownPart(props: { part: MessagePart }) {
return (
<div class="unknown-part text-xs text-muted-foreground">
Unknown part type: {props.part.type}
</div>
);
}
[MODIFY]
workspace-view/chat-area/message-list.tsx
Update to use parts-based rendering.

- import { MessageParts } from "/@/components/message-parts";
- import type { ChatUIMessage } from "/@/types/ui-message";
  interface MessageListProps {

* messages: Message[];

- messages: ChatUIMessage[];
  isGenerating: boolean;
  thinkingContent?: string;
  }
  // In MessageBubble component:

* <div class="text-message">{message.content}</div>

- <MessageParts parts={message.parts} />
  [MODIFY] 
  workspace-view/index.tsx
  Integrate useChat hook and API client.

- import { createSignal, onMount, Show } from "solid-js";
- import { useChat } from "/@/hooks/use-chat";
- import { EkacodeApiClient } from "/@/lib/api-client";
- import type { ChatUIMessage, RLMStateData } from "/@/types/ui-message";
  export default function WorkspaceView() {
  const params = useParams();
- const [client, setClient] = createSignal<EkacodeApiClient | null>(null);
- const [workspace, setWorkspace] = createSignal<string>("");
- // Initialize API client from preload
- onMount(async () => {
- const config = await window.ekacodeAPI.server.getConfig();
- setClient(new EkacodeApiClient(config));
- // Get workspace from route or localStorage
- setWorkspace(params.path || localStorage.getItem("lastWorkspace") || "");
- });
- // Use chat hook when client is ready
- const chat = () => {
- const c = client();
- if (!c) return null;
- return useChat({
-     client: c,
-     workspace,
-     onError: (error) => console.error("Chat error:", error),
-     onRLMStateChange: (state) => console.log("RLM State:", state),
- });
- };
  // Replace mock handlers with real API:

* const handleSendMessage = (content: string) => {
* // Mock implementation
* };

- const handleSendMessage = async (content: string) => {
- const c = chat();
- if (c) {
-     await c.sendMessage(content);
- }
- };
  }
  Phase 5: Permission System Integration
  [NEW]
  hooks/use-permissions.ts
  SSE-based permission handling.

import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { EkacodeApiClient } from "../lib/api-client";
import type { PermissionRequestData } from "../types/ui-message";
interface UsePermissionsOptions {
client: EkacodeApiClient;
workspace: Accessor<string>;
sessionId: Accessor<string | null>;
}
interface UsePermissionsResult {
pending: Accessor<PermissionRequestData[]>;
currentRequest: Accessor<PermissionRequestData | null>;
approve: (id: string, patterns?: string[]) => Promise<void>;
deny: (id: string) => Promise<void>;
isConnected: Accessor<boolean>;
}
export function usePermissions(options: UsePermissionsOptions): UsePermissionsResult {
const { client, workspace, sessionId } = options;
const [pending, setPending] = createSignal<PermissionRequestData[]>([]);
const [isConnected, setIsConnected] = createSignal(false);
let eventSource: EventSource | null = null;
const connect = () => {
const ws = workspace();
if (!ws) return;
eventSource = client.connectToEvents(ws, sessionId() ?? undefined);
eventSource.onopen = () => {
setIsConnected(true);
};
eventSource.addEventListener("permission:request", (event) => {
const request = JSON.parse(event.data) as PermissionRequestData;
// Filter by session if we have one
const sid = sessionId();
if (!sid || request.sessionID === sid) {
setPending((prev) => [...prev, request]);
}
});
eventSource.onerror = () => {
setIsConnected(false);
// Reconnect after delay
setTimeout(connect, 3000);
};
};
// Auto-connect when workspace changes
connect();
onCleanup(() => {
eventSource?.close();
});
const approve = async (id: string, patterns?: string[]) => {
await client.approvePermission(id, true, patterns);
setPending((prev) => prev.filter((p) => p.id !== id));
};
const deny = async (id: string) => {
await client.approvePermission(id, false);
setPending((prev) => prev.filter((p) => p.id !== id));
};
const currentRequest = () => pending()[0] ?? null;
return {
pending,
currentRequest,
approve,
deny,
isConnected,
};
}
[NEW]
components/permission-dialog.tsx
Modal for permission requests.

import { Show } from "solid-js";
import type { PermissionRequestData } from "../types/ui-message";
import { cn } from "../lib/utils";
interface PermissionDialogProps {
request: PermissionRequestData | null;
onApprove: (id: string) => void;
onDeny: (id: string) => void;
}
export function PermissionDialog(props: PermissionDialogProps) {
return (
<Show when={props.request}>
{(request) => (

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
<div class="bg-card border border-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl">
<h2 class="text-lg font-semibold mb-4">Permission Required</h2>

            <div class="mb-4">
              <span class="text-sm text-muted-foreground">Tool:</span>
              <span class="ml-2 font-mono text-primary">{request().toolName}</span>
            </div>
            <Show when={request().args}>
              <div class="mb-4">
                <span class="text-sm text-muted-foreground">Arguments:</span>
                <pre class="mt-2 p-3 bg-muted/50 rounded-lg text-xs overflow-x-auto">
                  {JSON.stringify(request().args, null, 2)}
                </pre>
              </div>
            </Show>
            <div class="flex gap-3 justify-end">
              <button
                onClick={() => props.onDeny(request().id)}
                class={cn(
                  "px-4 py-2 rounded-lg",
                  "bg-destructive/10 text-destructive hover:bg-destructive/20",
                  "transition-colors"
                )}
              >
                Deny
              </button>
              <button
                onClick={() => props.onApprove(request().id)}
                class={cn(
                  "px-4 py-2 rounded-lg",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "transition-colors"
                )}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>

);
}
Phase 6: Session Management
[NEW]
hooks/use-session.ts
Session persistence and resume.

import { createSignal, createEffect, type Accessor } from "solid-js";
interface UseSessionOptions {
workspace: Accessor<string>;
}
interface UseSessionResult {
sessionId: Accessor<string | null>;
setSessionId: (id: string | null) => void;
clearSession: () => void;
}
export function useSession(options: UseSessionOptions): UseSessionResult {
const { workspace } = options;
const getStorageKey = () => `ekacode-session:${workspace()}`;
const [sessionId, setSessionIdInternal] = createSignal<string | null>(
localStorage.getItem(getStorageKey())
);
// Persist to localStorage
createEffect(() => {
const id = sessionId();
const key = getStorageKey();
if (id) {
localStorage.setItem(key, id);
} else {
localStorage.removeItem(key);
}
});
// Reload when workspace changes
createEffect(() => {
const key = getStorageKey();
const stored = localStorage.getItem(key);
setSessionIdInternal(stored);
});
const clearSession = () => {
setSessionIdInternal(null);
};
return {
sessionId,
setSessionId: setSessionIdInternal,
clearSession,
};
}
Phase 7: Server Enhancements
[MODIFY]
routes/chat.ts
Add custom data parts for RLM state and enhanced tool streaming.

- // Import custom data part types
- import type { RLMStateData, ProgressData } from "@ekacode/shared";
  // In the streaming execute function:
  const stream = createUIMessageStream({
  execute: async ({ writer }) => {
  // Send session data on new session
  if (sessionIsNew) {
  writer.write(createSessionMessage(session));
  }
- // Send RLM state updates as data parts
- const statusInterval = setInterval(() => {
-     const status = controller.getStatus();
-     writer.write({
-       type: "data-rlm-state",
-       id: "rlm",
-       transient: true, // Don't persist to history
-       data: {
-         phase: status.phase,
-         progress: status.progress,
-         activeAgents: status.activeAgents,
-       } as RLMStateData,
-     });
- }, 100);
  // ... existing workflow code ...
- clearInterval(statusInterval);
  },
  });
  Verification Plan
  Automated Tests

# Run existing server tests

pnpm --filter @ekacode/server test

# Run core tests

pnpm --filter @ekacode/core test

# Type checking

pnpm typecheck
Unit Tests for Store Performance
// apps/desktop/src/lib/chat/**tests**/store.test.ts
import { describe, it, expect } from "vitest";
import { createChatStore } from "../store";
describe("createChatStore", () => {
it("should handle high-frequency text deltas efficiently", () => {
const store = createChatStore();
store.addMessage({ id: "msg_1", role: "assistant", parts: [{ type: "text", text: "" }] });
const start = performance.now();
for (let i = 0; i < 100; i++) {
store.appendTextDelta("msg_1", "token ");
}
const duration = performance.now() - start;
expect(duration).toBeLessThan(10); // < 10ms for 100 updates
expect(store.get().messages[0].parts[0].text).toBe("token ".repeat(100));
});
});
Browser Testing
Streaming Performance Test

Send a message that generates 100+ tokens
Verify UI remains responsive during streaming
Check for memory leaks in DevTools
Parts Rendering Test

Trigger a tool call (e.g., file read)
Verify tool-call part appears during execution
Verify tool-result part appears with output
Permission Flow Test

Trigger a permission-required tool
Verify dialog appears via SSE
Approve and verify tool executes
Architecture Diagram
┌─────────────────────────────────────────────────────────────────────┐
│ Desktop UI (SolidJS) │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ MessageList │ │ ToolStatus │ │ InputArea │ │
│ │ <For parts> │ │ Component │ │ Component │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ useChat() Hook │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ - createStore for O(1) updates │ │
│ │ - produce() for streaming deltas │ │
│ │ - reconcile() for history sync │ │
│ │ - Parses UIMessage stream protocol │ │
│ └──────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Hono Server: UIMessage Stream │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ - createUIMessageStream() │ │
│ │ - writer.write(data-rlm-state) │ │
│ │ - writer.merge(result.toUIMessageStream()) │ │
│ │ - createUIMessageStreamResponse() │ │
│ └──────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Core: Workflow Engine │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ - SessionManager / SessionController │ │
│ │ - WorkflowEngine (explore → plan → build) │ │
│ │ - Tool execution with streaming │ │
│ │ - PermissionManager (SSE events) │ │
│ └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
Implementation Order
Phase 1: Type Definitions & API Client (2 files)
Phase 2: Store & Stream Parser (2 files)
Phase 3: useChat Hook (1 file)
Phase 4: Message Components (2 files)
Phase 5: Permission System (2 files)
Phase 6: Session Management (1 file)
Phase 7: Server Enhancements (1 file)
Estimated total: ~11 new files + 3 modifications

Dependencies
No new npm dependencies required. Uses existing:

ai (Vercel AI SDK) - already in server
solid-js/store - built into Solid
Native Fetch API
Native EventSource
Key References
Vercel AI SDK: Stream Protocol
Vercel AI SDK: Streaming Custom Data
Solid.js: Store Reactive Updates
Solid.js: produce
Solid.js: reconcile
