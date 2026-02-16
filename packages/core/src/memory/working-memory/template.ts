/**
 * Working Memory Template
 *
 * Default template for project context stored in Working Memory.
 * Used when creating new working memory for a resource.
 */

export const WORKING_MEMORY_TEMPLATE = `# Project Context

## Tech Stack
- Language:
- Framework:
- Database:
- Other key dependencies:

## Project Structure
- Main directory:
- Source directory:
- Test directory:

## User Preferences
- Testing framework:
- Code style:
- Other preferences:

## Current Work
- Active feature:
- Blocker:
- Last completed:
`;

export interface WorkingMemoryData {
  techStack?: {
    language?: string;
    framework?: string;
    database?: string;
    other?: string[];
  };
  projectStructure?: {
    mainDirectory?: string;
    sourceDirectory?: string;
    testDirectory?: string;
  };
  userPreferences?: {
    testingFramework?: string;
    codeStyle?: string;
    other?: string[];
  };
  currentWork?: {
    activeFeature?: string;
    blocker?: string;
    lastCompleted?: string;
  };
}

export function parseWorkingMemoryContent(content: string): WorkingMemoryData {
  const data: WorkingMemoryData = {};
  const lines = content.split("\n");
  let currentSection: keyof WorkingMemoryData | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "## Tech Stack") {
      currentSection = "techStack";
      data.techStack = {};
    } else if (trimmed === "## Project Structure") {
      currentSection = "projectStructure";
      data.projectStructure = {};
    } else if (trimmed === "## User Preferences") {
      currentSection = "userPreferences";
      data.userPreferences = {};
    } else if (trimmed === "## Current Work") {
      currentSection = "currentWork";
      data.currentWork = {};
    } else if (trimmed.startsWith("- ") && currentSection) {
      const value = trimmed.slice(2);
      const [key, ...rest] = value.split(":");
      const val = rest.join(":").trim();

      if (currentSection === "techStack") {
        if (key.toLowerCase().includes("language")) data.techStack!.language = val;
        else if (key.toLowerCase().includes("framework")) data.techStack!.framework = val;
        else if (key.toLowerCase().includes("database")) data.techStack!.database = val;
        else if (key.toLowerCase().includes("other")) data.techStack!.other = val ? [val] : [];
      } else if (currentSection === "projectStructure") {
        if (key.toLowerCase().includes("main")) data.projectStructure!.mainDirectory = val;
        else if (key.toLowerCase().includes("source")) data.projectStructure!.sourceDirectory = val;
        else if (key.toLowerCase().includes("test")) data.projectStructure!.testDirectory = val;
      } else if (currentSection === "userPreferences") {
        if (key.toLowerCase().includes("testing")) data.userPreferences!.testingFramework = val;
        else if (key.toLowerCase().includes("code")) data.userPreferences!.codeStyle = val;
        else if (key.toLowerCase().includes("other"))
          data.userPreferences!.other = val ? [val] : [];
      } else if (currentSection === "currentWork") {
        if (key.toLowerCase().includes("active")) data.currentWork!.activeFeature = val;
        else if (key.toLowerCase().includes("blocker")) data.currentWork!.blocker = val;
        else if (key.toLowerCase().includes("last")) data.currentWork!.lastCompleted = val;
      }
    }
  }

  return data;
}
