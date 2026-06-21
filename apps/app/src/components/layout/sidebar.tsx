export default function Sidebar() {
  return (
    <aside class="flex w-64 shrink-0 flex-col border-border border-r bg-card">
      <div class="flex h-10 items-center border-border border-b px-4">
        <span class="font-semibold text-foreground text-sm">sakti-code</span>
      </div>
      <div class="flex flex-1 items-center justify-center">
        <span class="text-muted-foreground text-xs">Sidebar</span>
      </div>
    </aside>
  );
}
