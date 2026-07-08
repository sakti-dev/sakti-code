## Purpose

The bash tool executes shell commands in the tool's working directory, streaming stdout and stderr with optional progress updates. Output is truncated to the last N lines or KB with the full output saved to a temp file. The tool supports custom timeout, abort signal, and configurable command prefix.

## Requirements

### Requirement: Bash tool factory accepts cwd

The system SHALL create a bash tool via `createBashTool(cwd, options?)`. Optional config includes `commandPrefix` and `operations` (for test injection).

#### Scenario: Create bash tool
- **WHEN** `createBashTool("/home/user/proj")` is called
- **THEN** commands execute in `/home/user/proj`

#### Scenario: Create bash tool with command prefix
- **WHEN** `createBashTool("/home/user/proj", { commandPrefix: "source env.sh" })` is called
- **THEN** the prefix is prepended before every command

### Requirement: Bash tool executes shell commands

The system SHALL accept `{ command, timeout? }`, spawn a shell subprocess (`$SHELL -c command`), and stream both stdout and stderr to the output. Default timeout is unlimited unless configured.

#### Scenario: Run a command and get output
- **WHEN** called with `{ command: "echo hello" }`
- **THEN** the output contains "hello"

#### Scenario: Stdout and stderr are both captured
- **WHEN** a command writes to both stdout and stderr
- **THEN** both streams appear in the output

### Requirement: Bash tool times out commands

The system SHALL kill the subprocess with SIGKILL when the timeout expires (in seconds), returning partial output with a timeout notice.

#### Scenario: Command times out
- **WHEN** called with `{ command: "sleep 10", timeout: 0.1 }`
- **THEN** the process is killed and an error is thrown with "timed out"

### Requirement: Bash tool reports non-zero exit codes

The system SHALL throw an error when the command exits with a non-zero code, including the exit code and partial output.

#### Scenario: Non-zero exit
- **WHEN** called with `{ command: "exit 1" }`
- **THEN** an error is thrown with "exited with code 1"

### Requirement: Bash tool truncates output

The system SHALL truncate output to the last N lines or KB (whichever is hit first). Full output is saved to a temp file with the path included in the truncation notice.

#### Scenario: Output truncated with full output path
- **WHEN** a command produces more than 2000 lines or 50KB
- **THEN** the output is truncated and the response includes a path to the full output file

### Requirement: Bash tool streams output via onUpdate

The system SHALL send periodic output updates via the `onUpdate` callback (throttled to 100ms intervals) while a command is running.

#### Scenario: Streaming updates
- **WHEN** a command produces output over time
- **THEN** the onUpdate callback receives progressive data

### Requirement: Bash tool aborts on signal

The system SHALL kill the subprocess with SIGKILL when the AbortSignal is triggered, returning promptly with an "aborted" error.

#### Scenario: Abort signal stops command
- **WHEN** the abort signal fires during a long-running command
- **THEN** the process is killed and the tool returns within 2 seconds

### Requirement: Bash tool rejects missing working directory

The system SHALL throw an error if the working directory does not exist, with a descriptive message.
