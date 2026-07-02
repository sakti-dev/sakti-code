import type { JSX } from "solid-js";
import { SettingsDialog } from "~/components/settings/settings-dialog";
import "./top-bar.css";
import ProjectTabBar from "./project-tab";

export default function TopBar(): JSX.Element {
  return (
    <div class="flex h-10 items-center bg-card px-4">
      <div class="flex-1" />
      <ProjectTabBar />
      <div class="flex flex-1 justify-end">
        <SettingsDialog />
      </div>
    </div>
  );
}
