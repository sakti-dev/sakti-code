/**
 * Tests for Spec Parser
 *
 * TDD: Test tasks.md parsing
 */

import {
  parseTasksMd,
  validateTaskDagFromParsed,
  type ParsedTaskInput,
} from "@sakti-code/core/spec/parser";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Spec Parser", () => {
  describe("parseTasksMd", () => {
    it("should parse a valid tasks.md file", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-test-"));
      const tasksFile = path.join(tempDir, "tasks.md");

      await fs.writeFile(
        tasksFile,
        `## T-1 — First Task

**Maps to requirements:** R-1, R-2

**Dependencies:** 

**Outcome:**
This is the outcome of the first task.

- [ ] Subtask 1
- [ ] Subtask 2

## T-2 — Second Task

**Maps to requirements:** R-2

**Dependencies:** T-1

**Outcome:**
This is the outcome of the second task.
`
      );

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe("T-1");
      expect(tasks[0].title).toBe("First Task");
      expect(tasks[0].requirements).toEqual(["R-1", "R-2"]);
      expect(tasks[0].dependencies).toEqual([]);
      expect(tasks[0].outcome).toBe("This is the outcome of the first task.");
      expect(tasks[0].subtasks).toEqual(["Subtask 1", "Subtask 2"]);

      expect(tasks[1].id).toBe("T-2");
      expect(tasks[1].requirements).toEqual(["R-2"]);
      expect(tasks[1].dependencies).toEqual(["T-1"]);

      await fs.rm(tempDir, { recursive: true });
    });

    it("should return empty array for file without tasks", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-test-"));
      const tasksFile = path.join(tempDir, "tasks.md");

      await fs.writeFile(tasksFile, "# Just a heading\n\nNo tasks here.");

      const tasks = await parseTasksMd(tasksFile);

      expect(tasks).toHaveLength(0);

      await fs.rm(tempDir, { recursive: true });
    });

    it("should handle missing files gracefully", async () => {
      const tasks = await parseTasksMd("/nonexistent/tasks.md");
      expect(tasks).toHaveLength(0);
    });
  });

  describe("validateTaskDagFromParsed", () => {
    it("should detect valid DAG", () => {
      const tasks = [
        {
          id: "T-1",
          title: "Task 1",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-2",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-1"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-3",
          title: "Task 3",
          requirements: [],
          dependencies: ["T-2"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];

      const result = validateTaskDagFromParsed(tasks);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
      expect(result.ready).toEqual(["T-1"]);
    });

    it("should detect cycles in dependencies", () => {
      const tasks = [
        {
          id: "T-1",
          title: "Task 1",
          requirements: [],
          dependencies: ["T-2"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-2",
          title: "Task 2",
          requirements: [],
          dependencies: ["T-1"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];

      const result = validateTaskDagFromParsed(tasks);

      expect(result.valid).toBe(false);
      expect(result.cycles).toHaveLength(1);
    });

    it("should detect self-referencing tasks", () => {
      const tasks = [
        {
          id: "T-1",
          title: "Task 1",
          requirements: [],
          dependencies: ["T-1"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];

      const result = validateTaskDagFromParsed(tasks);

      expect(result.valid).toBe(false);
    });

    it("should identify ready tasks (no dependencies)", () => {
      const tasks = [
        {
          id: "T-1",
          title: "Task 1",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-2",
          title: "Task 2",
          requirements: [],
          dependencies: [],
          outcome: "",
          notes: "",
          subtasks: [],
        },
        {
          id: "T-3",
          title: "Task 3",
          requirements: [],
          dependencies: ["T-1"],
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];

      const result = validateTaskDagFromParsed(tasks);

      expect(result.ready).toContain("T-1");
      expect(result.ready).toContain("T-2");
      expect(result.ready).not.toContain("T-3");
    });

    it("should handle tasks without dependencies array", () => {
      const tasks: ParsedTaskInput[] = [
        {
          id: "T-1",
          title: "Task 1",
          requirements: [],
          dependencies: undefined,
          outcome: "",
          notes: "",
          subtasks: [],
        },
      ];

      const result = validateTaskDagFromParsed(tasks);

      expect(result.valid).toBe(true);
      expect(result.ready).toContain("T-1");
    });
  });
});
