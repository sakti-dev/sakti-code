## Purpose

Branch summarization compresses abandoned session branches into summary entries when navigating the session tree. It collects entries from the old branch path, extracts file operations (read/modified files), prepares a token-budgeted message selection, and calls the LLM to generate a summary. Summaries are persisted as `branch_summary` entries in the session tree.

## Requirements

### Requirement: Collect entries for branch summary

The system SHALL provide `collectEntriesForBranchSummary` that, given a session, old leaf ID, and target ID, walks backward from the old leaf to the deepest common ancestor with the target path, collecting entries to summarize.

#### Scenario: Entries collected from divergent branch
- **WHEN** the old leaf diverged from the target at a common ancestor
- **THEN** entries from the old leaf back to (but not including) the common ancestor are returned in chronological order

#### Scenario: No previous leaf
- **WHEN** `oldLeafId` is null
- **THEN** an empty entries array is returned (nothing to summarize)

#### Scenario: Same branch (no divergence)
- **WHEN** the old leaf is on the same branch as the target
- **THEN** entries are collected up to the common ancestor

### Requirement: Prepare branch entries within a token budget

The system SHALL prepare branch entries for summarization by selecting messages within a token budget (context window minus reserve tokens). Messages are selected from newest to oldest; once the budget is exceeded, no more messages are added. Existing `branch_summary` entries contribute their file operations (read/modified files) to the preparation even if their messages are excluded.

#### Scenario: All messages fit within budget
- **WHEN** the total token estimate is under the budget
- **THEN** all messages are included in the preparation

#### Scenario: Budget exceeded
- **WHEN** adding a message would exceed the token budget
- **THEN** that message and all older messages are excluded from the preparation

#### Scenario: File operations accumulated from prior summaries
- **WHEN** the branch contains existing `branch_summary` entries with file operation details
- **THEN** their `readFiles` and `modifiedFiles` are accumulated into the preparation's file ops

### Requirement: Generate branch summary via LLM

The system SHALL generate a branch summary by serializing prepared messages to text (via `serializeConversation`), wrapping in `<conversation>` tags, and calling the LLM with the provided prompts (`systemPrompt`, `prompt`). Custom instructions can replace or append to the default prompt. The result is prepended with the preamble and appended with a formatted file operations list.

#### Scenario: Summary generated successfully
- **WHEN** messages are prepared and the LLM call succeeds
- **THEN** a summary is returned containing the preamble, LLM-generated text, and file operations list

#### Scenario: No messages to summarize
- **WHEN** no messages are selected for summarization
- **THEN** the summary is `"No content to summarize"` with empty file lists

#### Scenario: Summarization LLM call fails
- **WHEN** the LLM returns `finishReason: "error"`
- **THEN** an error result is returned with code `"summarization_failed"`

#### Scenario: Custom instructions appended
- **WHEN** `customInstructions` is provided without `replaceInstructions`
- **THEN** the instructions are appended as `"Additional focus: <instructions>"` to the default prompt

#### Scenario: Custom instructions replace default
- **WHEN** both `customInstructions` and `replaceInstructions: true` are provided
- **THEN** only the custom instructions are used (no default prompt)

### Requirement: Branch summary details track file operations

The system SHALL compute `readFiles` and `modifiedFiles` from all file operations extracted from the branch messages (including accumulated ops from prior summaries). These are attached to the `BranchSummaryResult` and stored as details on the `branch_summary` entry.

#### Scenario: File operations extracted from messages
- **WHEN** the branch contains tool calls that read `auth.ts` and wrote `index.ts`
- **THEN** the summary result has `readFiles: ["auth.ts"]` and `modifiedFiles: ["index.ts"]`

### Requirement: Summarization respects abort signal

The system SHALL pass the abort signal to the LLM call so summarization can be cancelled.

#### Scenario: Aborted during summarization
- **WHEN** the abort signal fires while the LLM is generating the summary
- **THEN** the LLM call is aborted and the result depends on the LLM's abort behavior

### Requirement: Both async and Effect-native APIs are provided

The system SHALL export `collectEntriesForBranchSummary`/`generateBranchSummary` (async) and `collectEntriesForBranchSummaryEffect`/`generateBranchSummaryEffect` (Effect-native).

#### Scenario: Effect-native usage
- **WHEN** `generateBranchSummaryEffect(entries, options)` is composed in an Effect pipeline
- **THEN** it returns `Effect<Result<BranchSummaryResult, BranchSummaryError>>`
