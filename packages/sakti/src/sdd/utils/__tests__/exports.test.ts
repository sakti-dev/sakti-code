import { describe, expect, it } from "vitest";
import * as sakti from "../../../index.js";

describe("sakti library exports SDD utils", () => {
  it("exports task-progress helpers", () => {
    expect(typeof sakti.getTaskProgressForChange).toBe("function");
    expect(typeof sakti.formatTaskStatus).toBe("function");
    expect(typeof sakti.countTasksFromContent).toBe("function");
  });

  it("exports the TaskProgress type (via runtime presence of the helpers)", () => {
    // TaskProgress is a type; verify the helpers that return it exist.
    const progress = sakti.countTasksFromContent("- [x] done\n- [ ] todo");
    expect(progress).toEqual({ total: 2, completed: 1 });
  });

  it("exports change-metadata readers", () => {
    expect(typeof sakti.readChangeMetadata).toBe("function");
    expect(typeof sakti.writeChangeMetadata).toBe("function");
    expect(typeof sakti.resolveSchemaForChange).toBe("function");
  });
});
