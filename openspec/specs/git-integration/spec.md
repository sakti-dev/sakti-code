# Git Integration

## Purpose

Read-only git visibility routes for the sakti-code server — expose working-tree
status, current branch, diffs, and recent log history for a project's cwd, keyed
by `projectId`. Mutations, structured porcelain parsing, and arbitrary-dir reads
are explicitly out of scope.

## Requirements

### Requirement: Cwd resolved from project
Every git route SHALL accept a `projectId` query parameter and resolve the working directory from `ProjectRepo.findById(projectId).cwd`. The route SHALL NOT accept a raw `cwd` from the client. When the project does not exist, the route SHALL return HTTP 404.

#### Scenario: unknown project
- **WHEN** `GET /api/git/status?projectId=<unknown>` is requested
- **THEN** the response status is 404

#### Scenario: valid project resolves its cwd
- **WHEN** `GET /api/git/status?projectId=<known>` is requested for a project whose cwd is a git repo with a modified file
- **THEN** the response status is 200 and the body contains the modified file's name

### Requirement: Shell-free git execution
Git SHALL be invoked via `Bun.spawn(["git", ...args], { cwd })` using an argv array, never through a shell string. User-supplied values (the diff `path`) SHALL be passed as a single argv element so they cannot inject shell metacharacters.

#### Scenario: diff path with shell metacharacters is treated literally
- **WHEN** `GET /api/git/diff?projectId=<id>&path=foo%3Brm` is requested (path contains `;rm`)
- **THEN** git receives `foo;rm` as a literal filename argument and no shell command runs
- **AND** the response does not reflect any shell execution (git simply reports no such path or an empty diff)

### Requirement: Status route
The system SHALL expose `GET /api/git/status?projectId=<id>` returning the text of `git status --short` for the project's cwd.

#### Scenario: status shows a modified file
- **WHEN** the project cwd is a repo with a tracked file that has been modified
- **THEN** the response status is 200 and the body contains the modified file's name

#### Scenario: status on a clean tree
- **WHEN** the project cwd is a repo with no changes
- **THEN** the response status is 200 and the body is empty

### Requirement: Branch route
The system SHALL expose `GET /api/git/branch?projectId=<id>` returning the current branch name (the text of `git branch --show-current`).

#### Scenario: returns the current branch
- **WHEN** the project cwd is a repo on a branch named `main`
- **THEN** the response status is 200 and the body contains `main`

### Requirement: Diff route
The system SHALL expose `GET /api/git/diff?projectId=<id>&staged=&path=` returning the text of `git diff` (working tree by default), `git diff --cached` when `staged` is true, optionally scoped to `path` when provided.

#### Scenario: working diff shows modifications
- **WHEN** a tracked file is modified (not staged) and `GET /api/git/diff?projectId=<id>` is requested
- **THEN** the response status is 200 and the body contains the diff of the working change

#### Scenario: staged diff respects the staged flag
- **WHEN** a change is staged and `GET /api/git/diff?projectId=<id>&staged=true` is requested
- **THEN** the response contains the staged change

### Requirement: Log route
The system SHALL expose `GET /api/git/log?projectId=<id>&limit=` returning the text of `git log -n <limit> --oneline` (default `limit` 20). The `limit` SHALL be constrained to non-negative integers.

#### Scenario: log returns recent commits
- **WHEN** `GET /api/git/log?projectId=<id>&limit=5` is requested on a repo with at least one commit
- **THEN** the response status is 200 and the body contains at least one `--oneline` commit line

#### Scenario: negative limit is rejected
- **WHEN** `GET /api/git/log?projectId=<id>&limit=-5` is requested
- **THEN** the response status is 422

### Requirement: Bounded execution with benign-exit handling
Each git invocation SHALL be bounded by a timeout (default 10 seconds); a process exceeding it SHALL be killed and the route SHALL return a timeout message rather than hanging. A non-zero git exit (e.g. clean tree, no such path) SHALL be treated as success: the route SHALL return HTTP 200 with whatever stdout/stderr git produced, rather than throwing. A failure to spawn the git binary (e.g. git not on `$PATH`) SHALL return HTTP 500.

#### Scenario: non-zero exit surfaces as 200 with output
- **WHEN** a git command exits non-zero for a benign reason (e.g. diff on a clean tree)
- **THEN** the response status is 200 and the body contains git's captured output

#### Scenario: runaway process is killed
- **WHEN** a git invocation does not complete within the timeout
- **THEN** the process is killed and the route returns a response indicating a timeout (not an indefinite hang)

#### Scenario: git binary missing
- **WHEN** the `git` binary cannot be found on `$PATH`
- **THEN** the route returns HTTP 500 rather than throwing an uncaught error

### Requirement: Registration via route composition
The git route module SHALL be registered through `buildServer`'s array-composition (the pattern established by `server-rest-api`), not by editing the foundation's `index.ts`.

#### Scenario: git routes available on a composed server
- **WHEN** `buildServer` is composed with this change's route module
- **THEN** the `/api/git/*` endpoints are available on the resulting server
- **AND** the foundation's `index.ts` was not edited to register them
