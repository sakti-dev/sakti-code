/**
 * Collapsible - Wrapper around @kobalte/core's collapsible component
 *
 * Provides an sakti-code-styled collapsible with arrow indicator.
 * Used for tool call expansions, thinking sections, etc.
 */

import { Collapsible as KobalteCollapsible } from "@kobalte/core/collapsible";
import { ChevronDown } from "lucide-solid";

/**
 * Collapsible component with sakti-code styling
 *
 * @example
 * ```tsx
 * <Collapsible open={isOpen()} onOpenChange={setIsOpen}>
 *   <Collapsible.Trigger>Toggle</Collapsible.Trigger>
 *   <Collapsible.Content>Content</Collapsible.Content>
 * </Collapsible>
 * ```
 */
export const Collapsible = Object.assign(KobalteCollapsible, {
  /**
   * Arrow indicator icon that rotates based on collapsed state
   * Uses data-expanded attribute from Kobalte's collapsible context
   */
  Arrow: () => (
    <ChevronDown class="text-muted-foreground data-expanded:rotate-180 h-4 w-4 transition-transform duration-200" />
  ),
});

export default Collapsible;
