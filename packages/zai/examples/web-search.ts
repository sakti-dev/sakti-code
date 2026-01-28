/**
 * Web search and retrieval examples for @ekacode/zai
 *
 * Run with:
 *   tsx examples/web-search.ts
 */

import { generateText } from "ai";
import { z } from "zod";
import { createZai } from "../src";

const zai = createZai({
  apiKey: process.env.ZAI_API_KEY,
});

// Example 1: Basic web search
async function basicWebSearch() {
  const { text, sources } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What are the latest developments in AI?",
    providerOptions: {
      zai: {
        web_search: {
          enable: true,
          search_result: true,
        },
      },
    },
  });

  console.log("Response:", text);
  if (sources) {
    console.log("\nSources:");
    for (const source of sources) {
      if (source.sourceType === "url") {
        console.log(`- ${source.title ?? source.url}: ${source.url}`);
      } else {
        const label = source.filename ?? source.mediaType;
        console.log(`- ${source.title}: ${label}`);
      }
    }
  }
}

// Example 2: Web search with recency filter
async function webSearchRecency() {
  const { text } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What happened in tech news this week?",
    providerOptions: {
      zai: {
        web_search: {
          enable: true,
          search_result: true,
          search_recency_filter: "oneDay", // oneDay, oneWeek, oneMonth, oneYear, noLimit
        },
      },
    },
  });

  console.log("Recent news:", text);
}

// Example 3: Domain-filtered web search
async function domainFilteredSearch() {
  const { text } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What are the latest papers on transformer architectures?",
    providerOptions: {
      zai: {
        web_search: {
          enable: true,
          search_result: true,
          search_domain_filter: "arxiv.org",
        },
      },
    },
  });

  console.log("Arxiv papers:", text);
}

// Example 4: High detail search results
async function highDetailSearch() {
  const { text, sources } = await generateText({
    model: zai("glm-4.7"),
    prompt: "Explain quantum computing",
    providerOptions: {
      zai: {
        web_search: {
          enable: true,
          search_result: true,
          content_size: "high", // or 'medium'
        },
      },
    },
  });

  console.log("Detailed response:", text);
  if (sources) {
    console.log("\nDetailed sources:", sources.length);
  }
}

// Example 5: Retrieval from knowledge base
async function retrievalExample() {
  const { text } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What does our documentation say about authentication?",
    providerOptions: {
      zai: {
        retrieval: {
          knowledge_id: "kb_123456",
          prompt_template: "Context: {context}\n\nQuestion: {question}",
        },
      },
    },
  });

  console.log("Knowledge base answer:", text);
}

// Example 6: Combined web search and tools
async function combinedSearchAndTools() {
  const { text, toolCalls, sources } = await generateText({
    model: zai("glm-4.7"),
    prompt: "Find the current stock price of AAPL and convert it to EUR",
    providerOptions: {
      zai: {
        web_search: {
          enable: true,
          search_result: true,
        },
      },
    },
    tools: {
      currencyConvert: {
        description: "Convert currency",
        inputSchema: z.object({
          amount: z.number(),
          from: z.string(),
          to: z.string(),
        }),
      },
    },
  });

  console.log("Response:", text);
  console.log("Tool calls:", toolCalls);
  if (sources) {
    console.log("Sources:", sources.length);
  }
}

// Run examples
async function main() {
  console.log("=== Web Search and Retrieval Examples ===\n");

  console.log("1. Basic Web Search:");
  await basicWebSearch();
  console.log("\n");

  console.log("2. Web Search with Recency Filter:");
  await webSearchRecency();
  console.log("\n");

  console.log("3. Domain-filtered Search:");
  await domainFilteredSearch();
  console.log("\n");

  console.log("4. High Detail Search:");
  await highDetailSearch();
  console.log("\n");

  console.log("5. Retrieval from Knowledge Base:");
  await retrievalExample();
  console.log("\n");

  console.log("6. Combined Search and Tools:");
  await combinedSearchAndTools();
  console.log("\n");
}

main().catch(console.error);
