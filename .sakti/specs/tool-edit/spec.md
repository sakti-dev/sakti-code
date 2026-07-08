## Purpose

The edit tool modifies file contents through exact text replacement (replace mode) or hashline patches (hashline mode). Both modes are exposed via the same tool name "edit" but with different schemas selected through tool factory options. Replace mode applies multiple targeted edits atomically; hashline mode applies line-anchored patch operations using content-addressable snapshots.

## Requirements

### Requirement: Edit tool factory accepts cwd and mode

The system SHALL create an edit tool via `createEditTool(cwd, options?)`. The factory accepts optional `mode` ("replace" or "hashline"), `operations`, `snapshotStore`, and `noopOwner` config. Default mode is `"replace"`.

#### Scenario: Create edit tool in replace mode
- **WHEN** `createEditTool("/home/user/proj")` is called
- **THEN** the tool operates in replace mode with the default schema

#### Scenario: Create edit tool in hashline mode
- **WHEN** `createEditTool("/home/user/proj", { mode: "hashline" })` is called
- **THEN** the tool operates in hashline mode with the hashline schema

### Requirement: Replace mode performs exact text replacement

The system SHALL accept `{ path, edits: [{ oldText, newText }] }`. Each edit replaces the first occurrence of `oldText` with `newText`. All edits are matched against the original file content, not incrementally. Overlapping or nested edits are rejected.

#### Scenario: Single edit
- **WHEN** called with `{ path: "edit.txt", edits: [{ oldText: "const x = 1", newText: "const x = 42" }] }`
- **THEN** the exact text is replaced

#### Scenario: Multiple edits
- **WHEN** called with 3 edits for the same file
- **THEN** all 3 replacements are applied atomically

#### Scenario: Non-unique oldText is rejected
- **WHEN** `oldText` matches multiple locations in the file
- **THEN** an error is thrown with a "unique" message and the file is unchanged

### Requirement: Replace mode is atomic

The system SHALL apply all-or-nothing: if any edit fails, no changes are written.

#### Scenario: Atomic — partial edit failure reverts all
- **WHEN** one of 3 edits fails (oldText not found)
- **THEN** none of the edits are applied and the file remains unchanged

#### Scenario: Empty edits array rejected
- **WHEN** called with an empty `edits` array
- **THEN** an error is thrown

### Requirement: Replace mode preserves BOM and line endings

The system SHALL strip, process, and restore BOM (UTF-8 byte-order mark). Original line endings (CRLF vs LF) are detected and preserved in the output.

#### Scenario: BOM preserved after edit
- **WHEN** editing a file with a UTF-8 BOM
- **THEN** the BOM is present in the output

#### Scenario: CRLF line endings preserved
- **WHEN** editing a file with CRLF line endings
- **THEN** CRLF is preserved in the output

### Requirement: Replace mode returns diff details

The system SHALL return `details` with `diff`, `patch`, and `firstChangedLine` after a successful edit.

#### Scenario: Success returns diff and patch
- **WHEN** a single edit succeeds
- **THEN** `details.diff` contains the change summary and `details.patch` contains a unified patch

### Requirement: Replace mode validates missing file

The system SHALL reject edits to a nonexistent file with an error indicating the file path.

#### Scenario: Edit missing file throws
- **WHEN** editing a file that does not exist
- **THEN** an error is thrown

### Requirement: Hashline mode applies patch operations

The system SHALL accept a hashline patch string `{ input }`. Sections start with `[path#HASH]` followed by line ops: `SWAP`, `DEL`, `INS.PRE`, `INS.POST`, `INS.HEAD`, `INS.TAIL`, `REM`, `MV`. Ops are line-number-anchored and 1-indexed. Block ops (`SWAP.BLK`, `DEL.BLK`, `INS.BLK.POST`) resolve multi-line constructs.

#### Scenario: Apply SWAP patch
- **WHEN** applying a SWAP op on a known line range
- **THEN** the lines are replaced and a compact diff preview is returned

#### Scenario: Apply DEL patch
- **WHEN** applying a DEL op on a known line range
- **THEN** the lines are deleted

#### Scenario: Apply SWAP.BLK on a function
- **WHEN** applying SWAP.BLK on a function definition
- **THEN** the entire block is replaced

#### Scenario: Apply DEL.BLK on a function
- **WHEN** applying DEL.BLK on a function definition
- **THEN** the entire block is deleted

#### Scenario: Apply INS.BLK.POST after a block
- **WHEN** applying INS.BLK.POST after a function
- **THEN** content is inserted after the block at sibling depth

#### Scenario: SWAP.BLK on single-line statement rejected
- **WHEN** applying SWAP.BLK on a single-line statement
- **THEN** an error is thrown indicating "single-line block"

### Requirement: Hashline mode validates content hash

The system SHALL reject the patch if the snapshot hash does not match the current file content, indicating the file has changed since it was last read.

#### Scenario: Stale hash rejected
- **WHEN** the file content has changed since the hash was recorded
- **THEN** an error is thrown

### Requirement: Hashline mode requires snapshotStore

The system SHALL throw an error if hashline mode is configured without a `snapshotStore`.

#### Scenario: No snapshotStore errors
- **WHEN** calling execute in hashline mode without a snapshotStore
- **THEN** an error is thrown

### Requirement: Hashline noop loop guard detects repeated identical edits

The system SHALL track consecutive identical no-op edits per file and escalate to a thrown error after 3 in a row. A non-noop edit on the same file resets the counter. The guard only activates when a `noopOwner` is configured.

#### Scenario: Three identical noops throw
- **WHEN** the same noop input is applied 3 times consecutively with a noopOwner
- **THEN** the third attempt throws an error with "in a row"

#### Scenario: Real edit resets noop counter
- **WHEN** a real (non-noop) edit lands on the same file
- **THEN** the noop counter resets to 0

#### Scenario: No escalation without noopOwner
- **WHEN** repeated identical noops are applied without a noopOwner
- **THEN** each returns normally without escalation
