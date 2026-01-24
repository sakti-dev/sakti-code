Yes, you can create a free open-source Greptile-like solution using AST parsers like ts-morph for TypeScript/JavaScript codebases to enable semantic understanding, chunking functions/classes, and RAG integration. [github](https://github.com/olasunkanmi-SE/ts-codebase-analyzer)

## Core Approach

Parse the codebase with ts-morph to traverse the AST, extracting structured data such as classes, methods, properties, interfaces, and dependencies into JSON or embeddings for vector search. Combine this with a vector database (e.g., LanceDB, PGVector) and local LLMs (e.g., via Ollama) for querying. [lancedb](https://lancedb.com/blog/building-rag-on-codebases-part-1/)

## Existing Projects

- **ts-codebase-analyzer**: Uses ts-morph under the hood to build hierarchical codebase maps (modules, classes, functions) explicitly for RAG systems, outputting JSON ready for embedding.
- **code-graph-rag**: Builds knowledge graphs from AST (Tree-sitter for multi-lang, adaptable to ts-morph), enabling precise RAG queries and edits across TypeScript/JS codebases. [slashdot](https://slashdot.org/software/p/Greptile/alternatives)

## Implementation Steps

1. Install ts-morph: `npm i ts-morph`.
2. Create a Project: Load source files, traverse AST with `project.getSourceFiles()`, extract nodes like `getClasses()`, `getFunctions()`.
3. Chunk and Embed: Generate summaries/docstrings from AST nodes, embed with Hugging Face models, store in vector DB.
4. Query Pipeline: Use semantic search + LLM for context-aware responses, similar to Greptile's agentic flow. [kimmo](https://kimmo.blog/posts/8-ast-based-refactoring-with-ts-morph/)
