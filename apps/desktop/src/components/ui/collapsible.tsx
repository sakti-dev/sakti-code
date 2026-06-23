import { Collapsible as KobalteCollapsible } from "@kobalte/core/collapsible";
import { FiChevronDown } from "solid-icons/fi";

export const Collapsible = Object.assign(KobalteCollapsible, {
  Arrow: () => (
    <FiChevronDown class="h-4 w-4 text-muted-foreground transition-transform duration-200 data-expanded:rotate-180" />
  ),
});

export default Collapsible;
