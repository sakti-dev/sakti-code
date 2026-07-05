/**
 * Static template strings for Bash completion scripts.
 * These are Bash-specific helper functions that never change.
 */

export const BASH_DYNAMIC_HELPERS = `# Dynamic completion helpers

_sakti_complete_changes() {
  local changes
  changes=$(sakti __complete changes 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$changes" -- "$cur"))
}

_sakti_complete_specs() {
  local specs
  specs=$(sakti __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$specs" -- "$cur"))
}

_sakti_complete_items() {
  local items
  items=$(sakti __complete changes 2>/dev/null | cut -f1; sakti __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$items" -- "$cur"))
}

_sakti_complete_schemas() {
  local schemas
  schemas=$(sakti __complete schemas 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$schemas" -- "$cur"))
}`;
