/**
 * Tests for Spec Parser
 *
 * Phase 2 - Spec System Tests
 * Tests verify:
 * - parseTasksMd: Parse tasks.md file into structured data
 * - validateTaskDagFromParsed: Detect cycles in task dependencies
 */

import { promises as fs } from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

describe("Spec Parser", () => {
  let parseTasksMd: typeof import("../../src/spec/parser").parseTasksMd;
  let validateTaskDagFromParsed: typeof import("../../src/spec/parser").validateTaskDagFromParsed;
  let tempDir: string;

  beforeAll(async () => {
    const parser = await import("../../src/spec/parser");
    parseTasksMd = parser.parseTasksMd;
    validateTaskDagFromParsed = parser.validateTaskDagFromParsed;

    tempDir = path.join("/tmp", `parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  describe("parseTasksMd", () => {
    it("should parse a tasks.md file with single task", async () => {
      const content = `# Tasks: user-auth

## Implementation Tasks

### T-001 — Implement login page
**Maps to requirements:** R-001, R-002

**Outcome:** User can log in with email/password

- [ ] Create login form component
- [ ] Add validation

**Dependencies:**
`;

      const tasksFile = path.join(tempDir, "tasks.md");
      await fs.writeFile(tasksFile, content);

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: "T-001",
        title: "Implement login page",
        requirements: ["R-001", "R-002"],
        dependencies: [],
      });
    });

    it("should parse multiple tasks with dependencies", async () => {
      const content = `# Tasks: user-auth

## Implementation Tasks

### T-001 — Implement login page
**Maps to requirements:** R-001

**Outcome:** Login page created

**Dependencies:**

### T-002 — Implement auth API
**Maps to requirements:** R-002

**Outcome:** Auth API created

**Dependencies:** T-001

### T-003 — Add session management
**Maps to requirements:** R-003

**Outcome:** Sessions work

**Dependencies:** T-002
`;

      const tasksFile = path.join(tempDir, "tasks.md");
      await fs.writeFile(tasksFile, content);

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks).toHaveLength(3);
      expect(tasks[0]).toMatchObject({ id: "T-001", dependencies: [] });
      expect(tasks[1]).toMatchObject({ id: "T-002", dependencies: ["T-001"] });
      expect(tasks[2]).toMatchObject({ id: "T-003", dependencies: ["T-002"] });
    });

    it("should parse task with multiple dependencies", async () => {
      const content = `# Tasks: api-v2

## Implementation Tasks

### T-001 — Create base API
**Maps to requirements:** R-001

**Outcome:** Base API works

**Dependencies:**

### T-002 — Add user endpoints
**Maps to requirements:** R-002

**Outcome:** User endpoints work

**Dependencies:** T-001

### T-003 — Add admin endpoints
**Maps to requirements:** R-003

**Outcome:** Admin endpoints work

**Dependencies:** T-001

### T-004 — Integrate user and admin
**Maps to requirements:** R-004

**Outcome:** Integration works

**Dependencies:** T-002, T-003
`;

      const tasksFile = path.join(tempDir, "tasks.md");
      await fs.writeFile(tasksFile, content);

      const tasks = await parseTasksMd(tasksFile);

      const task4 = tasks.find(t => t.id === "T-004");
      expect(task4?.dependencies).toEqual(["T-002", "T-003"]);
    });

    it("should parse task with subtasks", async () => {
      const content = `# Tasks: test-spec

## Implementation Tasks

### T-001 — Write tests
**Maps to requirements:** R-001

**Outcome:** Tests written

- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests

**Dependencies:**
`;

      const tasksFile = path.join(tempDir, "tasks.md");
      await fs.writeFile(tasksFile, content);

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks[0].subtasks).toEqual(["Unit tests", "Integration tests", "E2E tests"]);
    });

    it("should parse outcome field", async () => {
      const content = `# Tasks: test-spec

## Implementation Tasks

### T-001 — Create feature
**Maps to requirements:** R-001

**Outcome:** Feature is implemented and working with all edge cases handled

**Dependencies:**
`;

      const tasksFile = path.join(tempDir, "tasks.md");
      await fs.writeFile(tasksFile, content);

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks[0].outcome).toContain("Feature is implemented");
    });

    it("should return empty array when file doesn't exist", async () => {
      await expect(parseTasksMd("/nonexistent/tasks.md")).resolves.toEqual([]);
    });

    it("should handle tasks without explicit dependencies", async () => {
      const content = `# Tasks: simple

## Implementation Tasks

### T-001 — Simple task
**Maps to requirements:** R-001

**Outcome:** Done
`;

      const tasksFile = path.join(tempDir, "tasks.md");
      await fs.writeFile(tasksFile, content);

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks[0].dependencies).toEqual([]);
    });
  });

  describe("validateTaskDagFromParsed", () => {
    it("should return valid for empty tasks", () => {
      const result = validateTaskDagFromParsed([]);
      expect(result.valid).toBe(true);
      expect(result.cycles).toEqual([]);
    });

    it("should return valid for single task with no deps", () => {
      const tasks = [
        {
          id: "T-001",
          title: "Task",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];
      const result = validateTaskDagFromParsed(tasks);
      expect(result.valid).toBe(true);
    });

    it("should detect simple cycle", () => {
      const tasks = [
        {
          id: "T-001",
          title: "Task 1",
          requirements: [],
          dependencies: ["T-002"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-002",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-001"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];
      const result = validateTaskDagFromParsed(tasks);
      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it("should detect longer cycle", () => {
      const tasks = [
        {
          id: "T-001",
          title: "Task 1",
          requirements: [],
          dependencies: ["T-002"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-002",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-003"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-003",
          title: "Task 3",
          requirements: [],
          dependencies: ["T-001"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];
      const result = validateTaskDagFromParsed(tasks);
      expect(result.valid).toBe(false);
    });

    it("should return valid for linear dependencies", () => {
      const tasks = [
        {
          id: "T-001",
          title: "Task 1",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-002",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-001"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-003",
          title: "Task 3",
          requirements: [],
          dependencies: ["T-002"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];
      const result = validateTaskDagFromParsed(tasks);
      expect(result.valid).toBe(true);
      expect(result.ready).toContain("T-001");
    });

    it("should return valid for diamond dependencies", () => {
      const tasks = [
        {
          id: "T-001",
          title: "Task 1",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-002",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-001"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-003",
          title: "Task 3",
          requirements: [],
          dependencies: ["T-001"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-004",
          title: "Task 4",
          requirements: [],
          dependencies: ["T-002", "T-003"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];
      const result = validateTaskDagFromParsed(tasks);
      expect(result.valid).toBe(true);
    });

    it("should identify ready tasks (no dependencies)", () => {
      const tasks = [
        {
          id: "T-001",
          title: "Task 1",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-002",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-001"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];
      const result = validateTaskDagFromParsed(tasks);
      expect(result.ready).toEqual(["T-001"]);
    });
  });
});
