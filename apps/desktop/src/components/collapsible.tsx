/**
 * Collapsible - Wrapper around @kobalte/core's collapsible component
 *
 * Provides an ekacode-styled collapsible with arrow indicator.
 * Used for tool call expansions, thinking sections, etc.
 */

import { Collapsible as KobalteCollapsible } from "@kobalte/core/collapsible";
import { Icon } from "./icon";

/**
 * Collapsible component with ekacode styling
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
    <Icon
      name="chevron-down"
      class="text-muted-foreground h-4 w-4 transition-transform duration-200 data-[expanded]:rotate-180"
    />
  ),
});

export default Collapsible;
