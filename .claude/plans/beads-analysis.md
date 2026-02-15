# Beads Analysis: "A Memory Upgrade for Your Coding Agent"

## Table of Contents

1. [Overview](#overview)
2. [The "Memory Upgrade" Concept](#the-memory-upgrade-concept)
3. [Architecture](#architecture)
4. [Task System](#task-system)
5. [How Tasks Are Fed to Agents](#how-tasks-are-fed-to-agents)
6. [Data Structures](#data-structures)
7. [Storage Layer](#storage-layer)
8. [Compaction System](#compaction-system)
9. [Key Commands](#key-commands)
10. [Agent Workflow](#agent-workflow)
11. [Code Structure](#code-structure)
12. [Interesting Patterns](#interesting-patterns)

---

## Overview

**Beads** (CLI: `bd`) is a **distributed, git-backed graph issue tracker** designed specifically for AI coding agents. It's built by Steve Yegge.

**Core Value Proposition**: Replaces messy markdown plans with a dependency-aware graph, allowing agents to handle long-horizon tasks without losing context between sessions.

**Key Features**:

- Dolt-powered version-controlled SQL database
- Git-portable JSONL export
- Hash-based collision-free IDs
- Semantic "memory decay" compaction
- Agent-optimized JSON output
- Zero-conflict multi-agent workflows

---

## The "Memory Upgrade" Concept

### 1. Persistent Structured Memory

The "memory" in beads works as a replacement for ephemeral LLM context:

**Problem**: LLMs lose context between sessions. Agents working on long-horizon tasks forget what they were doing.

**Solution**: Beads provides persistent storage that survives session boundaries.

```
Traditional:  LLM Context (lost after session)
              └── Markdown plans (unstructured, get stale)

Beads:        Dolt Database (versioned, queryable)
              └── JSONL Export (git-portable, mergeable)
              └── Dependency Graph (blocker-aware)
```

### 2. Context Compaction ("Memory Decay")

Beads implements **semantic summarization** to compress old closed issues:

| Tier   | Age             | Reduction | Method              |
| ------ | --------------- | --------- | ------------------- |
| Tier 1 | 30+ days closed | 70%       | AI summarization    |
| Tier 2 | 90+ days closed | 95%       | Aggressive archival |

**Fields affected**:

- `description` → summarized
- `design` → cleared
- `notes` → cleared
- `acceptance_criteria` → cleared

**Metadata preserved**:

```go
CompactionLevel   int        // 1 or 2
CompactedAt       *time.Time // When compacted
CompactedAtCommit *string    // Git commit hash
OriginalSize      int        // Pre-compaction size
```

### 3. Hash-Based IDs

IDs like `bd-a1b2c3` are generated from **content hashes**:

- Prevents merge collisions in multi-agent/multi-branch workflows
- Same content = same ID (deterministic)
- No central ID allocation needed

```go
func (i *Issue) ComputeContentHash() string {
    h := sha256.New()
    // Hash all substantive fields...
    return fmt.Sprintf("%x", h.Sum(nil))
}
```

---

## Architecture

### High-Level Components

```
beads/
├── cmd/bd/                    # CLI commands (Cobra)
│   ├── main.go               # Entry point
│   ├── ready.go              # Ready work discovery
│   ├── compact.go            # Memory compaction
│   ├── create.go             # Issue creation
│   ├── update.go             # Issue updates
│   ├── sync.go               # Git sync
│   └── ...
│
├── internal/
│   ├── types/                # Core data structures
│   │   └── types.go          # Issue, Status, Dependency, etc.
│   │
│   ├── storage/              # Storage abstraction
│   │   ├── storage.go        # Interface definitions
│   │   ├── sqlite/           # SQLite implementation (legacy)
│   │   │   ├── ready.go      # GetReadyWork logic
│   │   │   └── ...
│   │   └── dolt/             # Dolt implementation (primary)
│   │
│   ├── compact/              # Compaction system
│   │   ├── compactor.go      # Core compaction logic
│   │   └── haiku.go          # AI summarization client
│   │
│   ├── beads/                # Public API helpers
│   ├── config/               # Configuration
│   ├── query/                # Query builders
│   └── ...
│
└── beads.go                  # Public Go API
```

### Storage Backend

**Primary: Dolt** (Git for data)

- Version-controlled SQL database
- Cell-level 3-way merge
- Native branching
- Auto-commit per mutation

**Legacy: SQLite**

- Fallback for environments without Dolt
- JSONL portability layer

**JSONL Portability**:

- All issues exported to `.beads/issues.jsonl`
- Git hooks auto-sync on commit/pull
- Enables git-based collaboration

---

## Task System

### Issue Lifecycle

```
┌──────────┐    claim     ┌─────────────┐    complete   ┌────────┐
│   open   │ ──────────► │ in_progress │ ────────────► │ closed │
└──────────┘              └─────────────┘               └────────┘
     │                          │
     │ blocked                  │ blocked
     ▼                          ▼
┌──────────┐              ┌──────────┐
│ blocked  │              │ blocked  │
└──────────┘              └──────────┘
     │                          │
     │ deferred                 │
     ▼
┌──────────┐
│ deferred │
└──────────┘
```

### Status Values

```go
const (
    StatusOpen       Status = "open"        // Ready to claim
    StatusInProgress Status = "in_progress" // Claimed, being worked
    StatusBlocked    Status = "blocked"     // Has open blockers
    StatusDeferred   Status = "deferred"    // Deliberately on ice
    StatusClosed     Status = "closed"      // Completed
    StatusPinned     Status = "pinned"      // Persistent anchor
    StatusHooked     Status = "hooked"      // On agent's hook
)
```

### Issue Types

```go
const (
    TypeBug      IssueType = "bug"       // Bug fix
    TypeFeature  IssueType = "feature"   // New feature
    TypeTask     IssueType = "task"      // General task
    TypeEpic     IssueType = "epic"      // Large container
    TypeChore    IssueType = "chore"     // Maintenance
    TypeDecision IssueType = "decision"  // ADR-style decision
)
```

**Excluded from ready work** (workflow types):

- `merge-request` - Processed by Refinery
- `gate` - Async wait conditions
- `molecule` - Workflow containers
- `message` - Mail/communication
- `agent` - Identity/state tracking
- `role` - Agent role definitions
- `rig` - Rig identity beads

### Dependency Types

```go
const (
    // Workflow (affect ready work)
    DepBlocks            = "blocks"             // A blocks B
    DepParentChild       = "parent-child"       // Hierarchy
    DepConditionalBlocks = "conditional-blocks" // B runs if A fails
    DepWaitsFor          = "waits-for"          // Fanout gate

    // Association (non-blocking)
    DepRelated           = "related"
    DepDiscoveredFrom    = "discovered-from"

    // Graph links
    DepRepliesTo         = "replies-to"    // Threading
    DepRelatesTo         = "relates-to"    // Knowledge graph
    DepDuplicates        = "duplicates"    // Deduplication
    DepSupersedes        = "supersedes"    // Version chain

    // Entity (HOP foundation)
    DepAuthoredBy        = "authored-by"
    DepAssignedTo        = "assigned-to"
    DepApprovedBy        = "approved-by"
    DepAttests           = "attests"       // Skill attestation
)
```

### Dependency Semantics

```go
func (d DependencyType) AffectsReadyWork() bool {
    return d == DepBlocks ||
           d == DepParentChild ||
           d == DepConditionalBlocks ||
           d == DepWaitsFor
}
```

---

## How Tasks Are Fed to Agents

### The `bd ready` Command

**Purpose**: Find work that is **truly claimable** (no open blockers).

**Algorithm** (`internal/storage/sqlite/ready.go`):

```sql
SELECT ... FROM issues i
WHERE
    -- Basic filters
    i.pinned = 0                           -- Not persistent anchors
    AND (i.ephemeral = 0 OR i.ephemeral IS NULL)  -- Not wisps
    AND i.status IN ('open', 'in_progress')       -- Active status

    -- Exclude workflow types
    AND i.issue_type NOT IN (
        'merge-request', 'gate', 'molecule',
        'message', 'agent', 'role', 'rig'
    )

    -- Exclude molecule/wisp steps by ID pattern
    AND i.id NOT LIKE '%-mol-%'
    AND i.id NOT LIKE '%-wisp-%'

    -- NOT in blocked cache (no open blockers)
    AND NOT EXISTS (
        SELECT 1 FROM blocked_issues_cache
        WHERE issue_id = i.id
    )

    -- Not deferred to future
    AND (i.defer_until IS NULL OR defer_until <= NOW)

ORDER BY [sort_policy]
LIMIT [limit]
```

### Blocked Issues Cache

**Purpose**: 25x performance improvement (752ms → 29ms on 10K issues).

**How it works**:

1. Materializes the result of "which issues have open blockers"
2. Invalidated on:
   - Adding/removing `blocks` or `parent-child` dependencies
   - Issue status changes
   - Issue closure

**Location**: `blocked_issues_cache` table

### Ready Work Filters

```go
type WorkFilter struct {
    Status          Status          // "open" or ""
    Type            string          // Issue type filter
    Priority        *int            // P0-P4
    Assignee        *string         // Owner filter
    Unassigned      bool            // No assignee
    Labels          []string        // AND semantics
    LabelsAny       []string        // OR semantics
    LabelPattern    string          // Glob pattern
    LabelRegex      string          // Regex pattern
    Limit           int             // Max results
    SortPolicy      SortPolicy      // hybrid/priority/oldest
    ParentID        *string         // Descendants of epic
    MolType         *MolType        // swarm/patrol/work
    WispType        *WispType       // Compaction classification
    IncludeDeferred bool            // Show future-deferred
    IncludeMolSteps bool            // Include mol/wisp IDs
}
```

### Sort Policies

```go
const (
    // Default: Recent = priority, Older = age
    SortPolicyHybrid SortPolicy = "hybrid"

    // Always priority first, then creation date
    // Good for autonomous execution
    SortPolicyPriority SortPolicy = "priority"

    // Oldest first
    // Good for backlog clearing
    SortPolicyOldest SortPolicy = "oldest"
)
```

---

## Data Structures

### Core Issue Type

```go
type Issue struct {
    // ===== Core Identification =====
    ID          string `json:"id"`
    ContentHash string `json:"-"`  // SHA256, not exported

    // ===== Content =====
    Title              string `json:"title"`
    Description        string `json:"description,omitempty"`
    Design             string `json:"design,omitempty"`
    AcceptanceCriteria string `json:"acceptance_criteria,omitempty"`
    Notes              string `json:"notes,omitempty"`
    SpecID             string `json:"spec_id,omitempty"`

    // ===== Status & Workflow =====
    Status    Status    `json:"status,omitempty"`
    Priority  int       `json:"priority"`  // 0-4, no omitempty
    IssueType IssueType `json:"issue_type,omitempty"`

    // ===== Assignment =====
    Assignee         string `json:"assignee,omitempty"`
    Owner            string `json:"owner,omitempty"`
    EstimatedMinutes *int   `json:"estimated_minutes,omitempty"`

    // ===== Timestamps =====
    CreatedAt       time.Time  `json:"created_at"`
    CreatedBy       string     `json:"created_by,omitempty"`
    UpdatedAt       time.Time  `json:"updated_at"`
    ClosedAt        *time.Time `json:"closed_at,omitempty"`
    CloseReason     string     `json:"close_reason,omitempty"`
    ClosedBySession string     `json:"closed_by_session,omitempty"`

    // ===== Time-Based Scheduling =====
    DueAt      *time.Time `json:"due_at,omitempty"`
    DeferUntil *time.Time `json:"defer_until,omitempty"`

    // ===== External Integration =====
    ExternalRef  *string `json:"external_ref,omitempty"`  // "gh-9", "jira-ABC"
    SourceSystem string  `json:"source_system,omitempty"`

    // ===== Custom Metadata =====
    Metadata json.RawMessage `json:"metadata,omitempty"`

    // ===== Compaction =====
    CompactionLevel   int        `json:"compaction_level,omitempty"`
    CompactedAt       *time.Time `json:"compacted_at,omitempty"`
    CompactedAtCommit *string    `json:"compacted_at_commit,omitempty"`
    OriginalSize      int        `json:"original_size,omitempty"`

    // ===== Relational Data =====
    Labels       []string      `json:"labels,omitempty"`
    Dependencies []*Dependency `json:"dependencies,omitempty"`
    Comments     []*Comment    `json:"comments,omitempty"`

    // ===== Context Markers =====
    Pinned     bool `json:"pinned,omitempty"`
    IsTemplate bool `json:"is_template,omitempty"`

    // ===== Agent Identity =====
    HookBead     string     `json:"hook_bead,omitempty"`
    RoleBead     string     `json:"role_bead,omitempty"`
    AgentState   AgentState `json:"agent_state,omitempty"`
    LastActivity *time.Time `json:"last_activity,omitempty"`
    RoleType     string     `json:"role_type,omitempty"`
    Rig          string     `json:"rig,omitempty"`

    // ===== Molecule Type =====
    MolType MolType `json:"mol_type,omitempty"`

    // ===== Work Type =====
    WorkType WorkType `json:"work_type,omitempty"`  // mutex/open_competition

    // ===== Event Fields =====
    EventKind string `json:"event_kind,omitempty"`
    Actor     string `json:"actor,omitempty"`
    Target    string `json:"target,omitempty"`
    Payload   string `json:"payload,omitempty"`
}
```

### Dependency Type

```go
type Dependency struct {
    IssueID     string         `json:"issue_id"`
    DependsOnID string         `json:"depends_on_id"`
    Type        DependencyType `json:"type"`
    CreatedAt   time.Time      `json:"created_at"`
    CreatedBy   string         `json:"created_by,omitempty"`
    Metadata    string         `json:"metadata,omitempty"`  // JSON blob
    ThreadID    string         `json:"thread_id,omitempty"` // Conversation grouping
}
```

### Entity Reference (HOP Foundation)

```go
type EntityRef struct {
    Name     string `json:"name,omitempty"`     // "polecat/Nux"
    Platform string `json:"platform,omitempty"` // "gastown", "github"
    Org      string `json:"org,omitempty"`      // "steveyegge"
    ID       string `json:"id,omitempty"`       // "polecat-nux"
}

func (e *EntityRef) URI() string {
    return fmt.Sprintf("entity://hop/%s/%s/%s", e.Platform, e.Org, e.ID)
}
```

---

## Storage Layer

### Storage Interface

```go
type Storage interface {
    // Core CRUD
    CreateIssue(ctx context.Context, issue *types.Issue) error
    GetIssue(ctx context.Context, id string) (*types.Issue, error)
    UpdateIssue(ctx context.Context, id string, updates map[string]interface{}, actor string) error
    DeleteIssue(ctx context.Context, id string) error

    // Queries
    ListIssues(ctx context.Context, filter types.IssueFilter) ([]*types.Issue, error)
    GetReadyWork(ctx context.Context, filter types.WorkFilter) ([]*types.Issue, error)
    GetBlockedIssues(ctx context.Context, filter types.WorkFilter) ([]*types.BlockedIssue, error)
    GetStatistics(ctx context.Context) (*types.Statistics, error)

    // Dependencies
    AddDependency(ctx context.Context, dep *types.Dependency) error
    RemoveDependency(ctx context.Context, issueID, dependsOnID string, depType types.DependencyType) error
    GetDependencies(ctx context.Context, issueID string) ([]*types.Dependency, error)

    // Labels
    AddLabel(ctx context.Context, issueID, label string) error
    RemoveLabel(ctx context.Context, issueID, label string) error

    // Comments
    AddComment(ctx context.Context, issueID, author, text string) error
    GetComments(ctx context.Context, issueID string) ([]*types.Comment, error)

    // Transaction support
    RunInTransaction(ctx context.Context, fn func(tx Transaction) error) error
}
```

### CompactableStorage Interface

```go
type CompactableStorage interface {
    Storage
    CheckEligibility(ctx context.Context, issueID string, tier int) (bool, string, error)
    GetTier1Candidates(ctx context.Context) ([]*types.CompactionCandidate, error)
    GetTier2Candidates(ctx context.Context) ([]*types.CompactionCandidate, error)
    ApplyCompaction(ctx context.Context, issueID string, tier, originalSize, compactedSize int, commitHash string) error
}
```

---

## Compaction System

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ bd compact  │────►│  Compactor  │────►│  haiku.AI   │
│ --analyze   │     │             │     │  Summarizer │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Storage   │
                    │  (Dolt/SQL) │
                    └─────────────┘
```

### Modes

1. **Analyze Mode** (no API key needed)

   ```bash
   bd compact --analyze --json
   ```

   - Exports candidates with full content
   - Agent reviews and generates summaries

2. **Apply Mode** (no API key needed)

   ```bash
   bd compact --apply --id bd-42 --summary summary.txt
   ```

   - Agent provides the summary
   - Beads applies it

3. **Auto Mode** (legacy, requires `ANTHROPIC_API_KEY`)
   ```bash
   bd compact --auto --all
   ```

   - AI-powered summarization
   - Uses Haiku client internally

### Compaction Flow

```go
func (c *Compactor) CompactTier1(ctx context.Context, issueID string) error {
    // 1. Check eligibility
    eligible, reason, _ := c.store.CheckEligibility(ctx, issueID, 1)

    // 2. Fetch issue
    issue, _ := c.store.GetIssue(ctx, issueID)

    // 3. Calculate original size
    originalSize := len(issue.Description) + len(issue.Design) +
                    len(issue.Notes) + len(issue.AcceptanceCriteria)

    // 4. Get AI summary
    summary, _ := c.summarizer.SummarizeTier1(ctx, issue)

    // 5. Verify reduction
    if len(summary) >= originalSize {
        return error // Would not reduce size
    }

    // 6. Update issue with summary
    c.store.UpdateIssue(ctx, issueID, map[string]interface{}{
        "description":         summary,
        "design":              "",
        "notes":               "",
        "acceptance_criteria": "",
    }, "compactor")

    // 7. Record compaction metadata
    c.store.ApplyCompaction(ctx, issueID, 1, originalSize, len(summary), commitHash)

    // 8. Add audit comment
    c.store.AddComment(ctx, issueID, "compactor", "Tier 1 compaction: ...")
}
```

### Eligibility Criteria

**Tier 1** (30+ days closed):

- Status is `closed`
- Closed 30+ days ago
- Not already compacted (compaction_level = 0)
- Has substantial content to compress

**Tier 2** (90+ days closed):

- Already Tier 1 compacted
- Closed 90+ days ago
- Ready for aggressive archival

---

## Key Commands

### Essential Commands

| Command                  | Description                 |
| ------------------------ | --------------------------- |
| `bd init`                | Initialize beads in project |
| `bd ready`               | Show claimable work         |
| `bd create "Title"`      | Create new issue            |
| `bd update <id> --claim` | Atomically claim task       |
| `bd close <id>`          | Complete work               |
| `bd sync`                | Sync DB with git            |
| `bd show <id>`           | View issue details          |

### Ready Work Variants

```bash
# Basic ready work
bd ready

# Filter by priority
bd ready -p 0              # P0 only

# Filter by type
bd ready -t bug

# Filter by labels
bd ready -l backend -l api

# Filter to epic descendants
bd ready --parent bd-epic123

# JSON output for agents
bd ready --json

# Different sort policy
bd ready --sort priority   # Priority-first
bd ready --sort oldest     # Oldest-first
```

### Dependency Management

```bash
# Add blocking dependency
bd dep add bd-child bd-parent blocks

# Add parent-child
bd dep add bd-task bd-epic parent-child

# Add relation
bd dep add bd-123 bd-456 related

# View dependencies
bd show bd-123
```

### Compaction Commands

```bash
# Statistics
bd compact --stats

# Analyze mode (get candidates)
bd compact --analyze --json

# Apply mode (agent provides summary)
bd compact --apply --id bd-42 --summary summary.txt

# Auto mode (AI-powered)
bd compact --auto --all

# Dolt garbage collection
bd compact --dolt
```

---

## Agent Workflow

### Recommended Session Pattern

```bash
# 1. Find work
bd ready --json

# 2. Claim work atomically
bd update bd-abc123 --claim

# 3. Do the work...

# 4. Close completed work
bd close bd-abc123 --reason "Completed"

# 5. Sync with git
bd sync

# 6. Verify push
git status  # Must show "up to date with origin"
```

### Atomic Claim

```bash
bd update <id> --claim
```

This is atomic (compare-and-swap):

- Sets `assignee` to current actor
- Sets `status` to `in_progress`
- Fails if already claimed

### Session End Checklist ("Landing the Plane")

1. File issues for remaining work
2. Run quality gates (tests, linters)
3. Update issue status (close finished work)
4. **PUSH TO REMOTE** (mandatory)
   ```bash
   git pull --rebase
   bd sync
   git push
   git status
   ```
5. Clean up git state (stash clear, prune)
6. Verify clean state
7. Choose next issue for next session

---

## Code Structure

### CLI Commands (cmd/bd/)

| File         | Purpose                     |
| ------------ | --------------------------- |
| `main.go`    | Entry point, Cobra setup    |
| `ready.go`   | Ready work discovery        |
| `blocked.go` | Blocked issues view         |
| `create.go`  | Issue creation              |
| `update.go`  | Issue updates, claim        |
| `close.go`   | Issue closure               |
| `compact.go` | Memory compaction           |
| `sync.go`    | Git synchronization         |
| `context.go` | CommandContext state holder |

### Internal Packages

| Package          | Purpose                  |
| ---------------- | ------------------------ |
| `types`          | Core data structures     |
| `storage`        | Storage interface        |
| `storage/sqlite` | SQLite implementation    |
| `storage/dolt`   | Dolt implementation      |
| `compact`        | Compaction logic         |
| `config`         | Configuration management |
| `query`          | Query builders           |
| `audit`          | Audit trail              |
| `hooks`          | Git hooks                |

---

## Interesting Patterns

### 1. CommandContext Pattern

Consolidates 20+ global variables into one struct:

```go
type CommandContext struct {
    DBPath       string
    Actor        string
    JSONOutput   bool
    Store        storage.Storage
    RootCtx      context.Context
    // ... many more
}

// Accessor functions for backward compatibility
func getStore() storage.Storage {
    if shouldUseGlobals() {
        return store  // Legacy global
    }
    return cmdCtx.Store
}
```

### 2. Blocked Issues Cache

Materialized view for 25x performance:

```go
// Instead of recursive CTE on every query:
// SELECT ... WHERE NOT EXISTS (recursive blocker check)

// Use pre-computed cache:
// SELECT ... WHERE NOT EXISTS (
//     SELECT 1 FROM blocked_issues_cache WHERE issue_id = i.id
// )
```

### 3. Content Hash IDs

Deterministic ID generation:

```go
func (i *Issue) ComputeContentHash() string {
    h := sha256.New()
    w := hashFieldWriter{h}
    w.str(i.Title)
    w.str(i.Description)
    // ... hash all substantive fields
    return fmt.Sprintf("%x", h.Sum(nil))
}
```

### 4. Dependency Type Polymorphism

Single `Dependency` table with type discrimination:

```go
type Dependency struct {
    IssueID     string
    DependsOnID string
    Type        DependencyType  // blocks, parent-child, related, etc.
    Metadata    string          // JSON for type-specific data
}
```

### 5. JSONL Portability

Git-friendly serialization:

```go
// Export: Dolt → JSONL
bd sync --export

// Import: JSONL → Dolt
bd sync --import

// Auto via git hooks:
// pre-commit: export to JSONL, stage
// post-merge: import from JSONL
```

### 6. Federation Support

Multi-repo issue tracking:

```go
type Issue struct {
    SourceRepo     string `json:"-"`  // Which repo owns this
    SourceSystem   string `json:"source_system,omitempty"`
    ExternalRef    *string `json:"external_ref,omitempty"`  // "gh-9"
}
```

### 7. Time-Based Deferral

Hide issues until future time:

```go
type Issue struct {
    DeferUntil *time.Time `json:"defer_until,omitempty"`
}

// Query:
// WHERE (i.defer_until IS NULL OR defer_until <= NOW)
```

### 8. Agent Identity Tracking

Track agent state and work:

```go
type Issue struct {
    HookBead     string     // Current work on hook (0..1)
    RoleBead     string     // Role definition
    AgentState   AgentState // idle|running|stuck|stopped
    LastActivity *time.Time // Timeout detection
}
```

---

## Configuration

### Config File (.beads/config.yaml)

```yaml
# ID prefix
prefix: bd

# Custom statuses
status:
  custom: "review,testing"

# Custom types
types:
  custom: "molecule,gate,convoy"

# Ready work exclusions
ready:
  exclude_id_patterns:
    - "-mol-"
    - "-wisp-"

# External projects (federation)
external_projects:
  - name: upstream
    path: ../other-repo
```

### Environment Variables

```bash
BEADS_DB=/path/to/db    # Override database path
ANTHROPIC_API_KEY=...   # For compact --auto
```

---

## Integration Points

### Git Hooks

```bash
# Install hooks
bd hooks install

# Creates:
# .git/hooks/pre-commit  → exports JSONL, stages
# .git/hooks/post-merge  → imports JSONL
```

### MCP Server

Beads includes an MCP (Model Context Protocol) server:

```bash
# Install
pip install beads-mcp

# Use with Claude Desktop
# Configured via MCP settings
```

### Claude Plugin

Located in `claude-plugin/` - provides native Claude integration.

---

## Summary

**Beads is essentially**:

1. A **task graph database** (Dolt/SQLite) with dependencies
2. A **git-native sync layer** (JSONL export/import)
3. A **compaction engine** for memory management
4. An **agent-optimized CLI** with JSON output

**The "memory upgrade"**:

- Replaces ephemeral LLM context with persistent graph storage
- Implements "memory decay" via semantic compaction
- Enables long-horizon task tracking across sessions

**Key innovation**:

- `bd ready` computes truly claimable work via blocker-aware queries
- Blocked issues cache provides 25x performance improvement
- Content-hash IDs enable zero-conflict multi-agent workflows
