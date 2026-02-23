/**
 * Tests for Observer Agent - TDD
 *
 * Tests verify:
 * - parseObserverOutput: Extract observations, current-task, suggested-response from XML
 * - Handle various output formats including fallback to raw text
 */

import { parseObserverOutput } from "@/memory/observation/observer";
import { describe, expect, it } from "vitest";

describe("Observer Agent", () => {
  describe("parseObserverOutput", () => {
    it("should extract observations from XML", () => {
      const text = `<observations>
Date: Dec 4, 2025
* 🔴 (09:00) User stated they use TypeScript
</observations>

<current-task>
Implement login
</current-task>

<suggested-response>
Starting login implementation
</suggested-response>`;

      const result = parseObserverOutput(text);

      expect(result.observations).toContain("TypeScript");
      expect(result.currentTask).toBe("Implement login");
      expect(result.suggestedResponse).toBe("Starting login implementation");
    });

    it("should fallback to raw text if no XML found", () => {
      const text = "Just some plain text response";

      const result = parseObserverOutput(text);

      expect(result.observations).toBe("Just some plain text response");
    });

    it("should handle missing optional fields", () => {
      const text = `<observations>
* 🟡 Test observation
</observations>`;

      const result = parseObserverOutput(text);

      expect(result.observations).toContain("Test observation");
      expect(result.currentTask).toBeUndefined();
      expect(result.suggestedResponse).toBeUndefined();
    });

    it("should handle observations with multiple dates", () => {
      const text = `<observations>
Date: Dec 4, 2025
* 🔴 (09:00) User started session

Date: Dec 5, 2025
* 🟡 (10:00) User added new feature
</observations>

<current-task>
Add new feature
</current-task>`;

      const result = parseObserverOutput(text);

      expect(result.observations).toContain("Dec 4, 2025");
      expect(result.observations).toContain("Dec 5, 2025");
      expect(result.currentTask).toBe("Add new feature");
    });

    it("should handle priority emojis in observations", () => {
      const text = `<observations>
* 🔴 High priority observation
* 🟡 Medium priority observation
* 🟢 Low priority observation
</observations>`;

      const result = parseObserverOutput(text);

      expect(result.observations).toContain("🔴");
      expect(result.observations).toContain("🟡");
      expect(result.observations).toContain("🟢");
    });

    it("should extract suggested response with newlines", () => {
      const text = `<observations>
* 🟡 Test observation
</observations>

<suggested-response>
Line 1
Line 2
Line 3
</suggested-response>`;

      const result = parseObserverOutput(text);

      expect(result.suggestedResponse).toContain("Line 1");
      expect(result.suggestedResponse).toContain("Line 2");
      expect(result.suggestedResponse).toContain("Line 3");
    });

    it("should handle empty observations tag", () => {
      const text = `<observations>
</observations>

<current-task>
Test task
</current-task>`;

      const result = parseObserverOutput(text);

      expect(result.observations).toBe("");
      expect(result.currentTask).toBe("Test task");
    });
  });
});
