import { createSignal } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { SETTINGS_TABS, SettingsSidebar } from "./settings-sidebar";

interface SettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabLabel = () =>
    SETTINGS_TABS.find((t) => t.id === activeTab())?.label ?? "Settings";

  const activeTabDescription = () => {
    if (activeTab() === "general") {
      return "Configure your preferences";
    }
    return `Configure ${activeTab()} settings`;
  };

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogContent class="flex h-[600px] w-full max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader class="flex items-center justify-between border-border/80 border-b px-4 pt-4 pb-4">
          <div class="flex flex-col">
            <DialogTitle>{activeTabLabel()}</DialogTitle>
            <DialogDescription>{activeTabDescription()}</DialogDescription>
          </div>
        </DialogHeader>

        <div class="flex flex-1 overflow-hidden">
          <div class="w-56 shrink-0 border-border/80 border-r bg-background/35">
            <ScrollArea class="h-full">
              <SettingsSidebar
                activeTab={activeTab()}
                onTabChange={setActiveTab}
              />
            </ScrollArea>
          </div>

          <div class="flex-1 overflow-y-auto px-4 pb-0">
            <div class="max-h-full overflow-y-auto pr-2">
              <div class="py-8 text-center text-muted-foreground text-sm">
                {activeTabLabel()} settings
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
