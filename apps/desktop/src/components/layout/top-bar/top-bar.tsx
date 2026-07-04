import type { JSX } from "solid-js";
import { openSettingsTab } from "~/stores/workspace/project-tab-store";
import "./top-bar.css";
import ProjectTabBar from "./project-tab";

export default function TopBar(): JSX.Element {
  return (
    <div class="flex h-10 items-center bg-card px-4">
      <div class="flex-1" />
      <ProjectTabBar />
      <div class="flex flex-1 justify-end">
        <button
          class="flex items-center gap-1.5 rounded-md border-border bg-card px-2 py-1 font-medium text-foreground text-xs transition-colors hover:border-muted-foreground hover:bg-secondary"
          onClick={() => openSettingsTab()}
          title="Settings"
          type="button"
        >
          <svg
            aria-label="Settings"
            class="h-3.5 w-3.5"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Settings</title>
            <path
              clip-rule="evenodd"
              d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.17 1.699c.484.12.94.312 1.356.562l1.321-.832a.5.5 0 0 1 .67.065l.774.775a.5.5 0 0 1 .066.67l-.832 1.32c.25.417.443.873.563 1.357l1.699.17a.5.5 0 0 1 .45.496v1.096a.5.5 0 0 1-.45.497l-1.699.17c-.12.484-.312.94-.562 1.356l.832 1.321a.5.5 0 0 1-.066.67l-.774.774a.5.5 0 0 1-.67.066l-1.32-.832c-.417.25-.873.443-1.357.563l-.17 1.699a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.17-1.699a4.973 4.973 0 0 1-1.356-.562l-1.321.832a.5.5 0 0 1-.67-.066l-.774-.774a.5.5 0 0 1-.066-.67l.832-1.32a4.972 4.972 0 0 1-.563-1.357l-1.699-.17A.5.5 0 0 1 1 8.548V7.452a.5.5 0 0 1 .45-.497l1.699-.17c.12-.484.312-.94.562-1.356l-.832-1.321a.5.5 0 0 1 .066-.67l.774-.774a.5.5 0 0 1 .67-.066l1.32.832c.417-.25.873-.443 1.357-.563l.17-1.699zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
