/**
 * memory-search tool
 *
 * Search past conversations using BM25 + recency ranking.
 *
 * Uses SQLite FTS5 for full-text search with BM25 ranking,
 * plus a recency boost to prioritize newer messages when
 * keyword match quality is similar.
 */

import { tool } from "ai";
import { z } from "zod";
import { messageStorage } from "./message/storage";

export const memorySearchTool = tool({
  description: `Search past conversations using BM25 + recency ranking.

This tool searches through all stored messages using SQLite FTS5 full-text search.
It uses BM25 ranking with a recency boost to find the most relevant recent messages.

Best for:
- Finding code snippets from earlier in the conversation
- Retrieving specific implementation details
- Looking up previously discussed files or functions
- Finding decisions or context from past messages

Query tips:
- Use specific keywords like function names, file paths, or technical terms
- "LoginSchema" will find the exact schema definition
- "auth.ts JWT" will find messages mentioning both
- Code identifiers are preserved (e.g., "refresh_tokens" is one token)

Examples:
- Search: { "query": "LoginSchema" }
- With thread filter: { "query": "authentication", "threadId": "thread-123" }
- Limit results: { "query": "Zod validation", "limit": 3 }`,
  inputSchema: z.object({
    query: z.string().describe("Search query using FTS5 MATCH syntax"),
    threadId: z.string().optional().describe("Optional: limit search to specific thread"),
    limit: z.number().default(5).describe("Maximum number of results (default: 5)"),
  }),
  execute: async input => executeMemorySearch(input),
});

export interface SearchResult {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  messageIndex: number;
  matchScore: number;
  rank: number;
}

export async function executeMemorySearch(input: {
  query: string;
  threadId?: string;
  limit?: number;
}): Promise<{ success: true; results: SearchResult[] } | { success: false; error: string }> {
  try {
    const messages = await messageStorage.searchMessagesWithRecency(
      input.query,
      input.limit ?? 5,
      input.threadId
    );

    const results: SearchResult[] = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.injection_text,
      createdAt: m.created_at.toISOString(),
      messageIndex: m.message_index,
      matchScore: m.matchScore,
      rank: m.finalRank,
    }));

    return { success: true, results };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
