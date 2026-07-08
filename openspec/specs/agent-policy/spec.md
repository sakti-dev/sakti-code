## Purpose

The agent policy layer composes the system prompt from base text, tool inventory, skills advertisements, and environment info. It manages agent definitions (loaded from markdown files), skill loading, prompt template loading, and permission evaluation for tool access control.

## Requirements

### Requirement: System prompt composition from blocks

The system SHALL provide `composeSystemPrompt` that assembles a complete system prompt from: (1) the agent's base system prompt, (2) a rendered tool inventory (`# Tool: <name>` sections), (3) a skills advertisement (`<available_skills>` block, gated on the `read` tool being available), and (4) an optional environment info block. Blocks are joined with double newlines.

#### Scenario: Full composition with all blocks
- **WHEN** `composeSystemPrompt` is called with a base prompt, tools, skills, `hasRead: true`, skills instructions, and environment
- **THEN** the result contains the base prompt, tool inventory, skills block, and environment block separated by double newlines

#### Scenario: No skills when read tool unavailable
- **WHEN** `hasRead: false`
- **THEN** no skills block is included

#### Scenario: No environment block
- **WHEN** no environment string is provided
- **THEN** the result contains only base prompt, tool inventory, and optional skills

### Requirement: Skills block is appendable and strippable

The system SHALL provide `appendSkillsBlock` to add a skills advertisement to a composed prompt, and `stripSkillsBlock` to remove it. `stripSkillsBlock` uses the first line of `skillsInstructions` as a sentinel marker.

#### Scenario: Append skills block
- **WHEN** `appendSkillsBlock(basePrompt, skills, true, instructions)` is called
- **THEN** the skills block is appended to the base prompt

#### Scenario: Strip skills block
- **WHEN** `stripSkillsBlock(composedPrompt, instructions)` is called
- **THEN** everything from the skills marker onward is removed, returning the base prompt

### Requirement: Tool inventory is strippable

The system SHALL provide `stripToolInventory` to remove the `# Tool:` sections from a composed prompt. To strip both tools and skills, chain `stripToolInventory(stripSkillsBlock(composed, instructions))`.

#### Scenario: Strip tool inventory
- **WHEN** `stripToolInventory(composedPrompt)` is called
- **THEN** everything from the first `# Tool:` heading onward is removed

### Requirement: Environment info block formatted

The system SHALL provide `formatEnvironmentBlock` that renders working directory, git status, platform, date, and optional model ID as an `<env>` XML block.

#### Scenario: Full environment block
- **WHEN** `formatEnvironmentBlock({ workingDirectory, isGitRepo: true, platform, date, modelId })` is called
- **THEN** the output contains all fields including `Model: <modelId>`

### Requirement: Agent definitions loaded from markdown files

The system SHALL provide `loadAgents` that scans `agent/` or `agents/` subtrees in one or more config directories. Each `.md` file becomes an `AgentDefinition`: YAML frontmatter supplies `mode`/`hidden`/`description`/`model`, the body becomes `systemPrompt`. Entry names are derived from the path.

#### Scenario: Agents loaded from directory
- **WHEN** `loadAgents` is called with a directory containing `agents/code.md`
- **THEN** an `AgentDefinition` is created with name `"code"`, mode `"all"` (default), and the markdown body as systemPrompt

#### Scenario: Agent with explicit mode
- **WHEN** a markdown file has frontmatter `mode: primary`
- **THEN** the agent's mode is `"primary"`

#### Scenario: Agent model reference parsed
- **WHEN** a markdown file has frontmatter `model: "anthropic/claude-sonnet-4-20250514"`
- **THEN** the agent's model is `{ providerId: "anthropic", modelId: "claude-sonnet-4-20250514" }`

#### Scenario: Missing directories skipped silently
- **WHEN** a config directory does not exist
- **THEN** it is skipped with no error

#### Scenario: Read/parse failures returned as diagnostics
- **WHEN** an agent file cannot be read or parsed
- **THEN** a diagnostic is returned and the agent is not included in the result

### Requirement: defineAgent validates required fields

The system SHALL provide `defineAgent` that throws if `name` or `systemPrompt` is missing, and returns the validated `AgentDefinition`.

#### Scenario: Valid agent
- **WHEN** `defineAgent({ name: "code", systemPrompt: "..." })` is called
- **THEN** the input is returned unchanged

#### Scenario: Missing name throws
- **WHEN** `defineAgent({ systemPrompt: "..." })` is called
- **THEN** an error is thrown with `"name is required"`

### Requirement: Skills loaded from SKILL.md files

The system SHALL provide `loadSkills` that recursively scans directories for `SKILL.md` files and direct root `.md` files. Each skill requires a `description` (in frontmatter or from the first line). Skills without descriptions are excluded. Name validation enforces lowercase alphanumeric with hyphens.

#### Scenario: Skills loaded from directory
- **WHEN** `loadSkills` is called with a directory containing subdirectories with `SKILL.md` files
- **THEN** each skill is loaded with `name`, `description`, `content` (markdown body), and `filePath`

#### Scenario: Skill without description excluded
- **WHEN** a `SKILL.md` has no frontmatter description and empty body
- **THEN** the skill is excluded

#### Scenario: Sourced skills with provenance
- **WHEN** `loadSourcedSkills` is called with source-tagged inputs
- **THEN** each skill and diagnostic carries the source value

#### Scenario: Ignore files not honored
- **WHEN** a skill directory is inside a gitignored path
- **THEN** the skill is still loaded (ignore files are deliberately not honored)

### Requirement: Prompt templates loaded from directories or files

The system SHALL provide `loadPromptTemplates` that loads `.md` files from directories (non-recursively) or individual file paths. Template name is derived from the filename. Description comes from frontmatter or the first content line (truncated to 60 chars).

#### Scenario: Templates loaded from directory
- **WHEN** `loadPromptTemplates` is called with a directory of `.md` files
- **THEN** each file becomes a `PromptTemplate` with name from filename, content from body

#### Scenario: Template argument substitution
- **WHEN** `formatPromptTemplateInvocation(template, ["file.ts", "read"])` is called on a template with `$1` and `$ARGUMENTS`
- **THEN** `$1` is replaced with `"file.ts"` and `$ARGUMENTS` with `"file.ts read"`

### Requirement: Permission evaluation with glob matching

The system SHALL provide `evaluate(permission, pattern, ...rulesets)` that finds the last matching rule across merged rulesets (last match wins). Rules match using glob patterns (`*` = any chars, `?` = single char). `~` and `$HOME` are expanded in patterns. Unmatched requests default to `"ask"`.

#### Scenario: Explicit allow
- **WHEN** a rule `{ permission: "bash", action: "allow", pattern: "*" }` is the last match
- **THEN** `"allow"` is returned

#### Scenario: Explicit deny
- **WHEN** a rule `{ permission: "bash", action: "deny", pattern: "rm *" }` matches
- **THEN** `"deny"` is returned

#### Scenario: Last match wins
- **WHEN** two rulesets have conflicting rules for the same permission/pattern
- **THEN** the rule from the last ruleset wins

#### Scenario: No match defaults to ask
- **WHEN** no rule matches the given permission and pattern
- **THEN** `"ask"` is returned

#### Scenario: Tilde expansion in patterns
- **WHEN** a pattern contains `~/projects`
- **THEN** `~` is expanded to the home directory

### Requirement: fromConfig builds ruleset from flat config

The system SHALL provide `fromConfig` that converts a nested `Record<string, PermissionAction | Record<string, PermissionAction>>` into a flat `PermissionRuleset`. String values become wildcard patterns.

#### Scenario: Simple config
- **WHEN** `{ bash: "allow", read: { "/tmp/*": "allow", "*": "deny" } }` is passed
- **THEN** three rules are created: bash wildcard allow, read `/tmp/*` allow, read `*` deny

### Requirement: disabled finds tools with wildcard deny

The system SHALL provide `disabled(tools, ruleset)` that returns a set of tool names that have a wildcard (`pattern: "*"`) deny rule.

#### Scenario: Tool with wildcard deny
- **WHEN** `disabled(["bash", "read"], ruleset)` is called and bash has a wildcard deny
- **THEN** the result contains `"bash"`
