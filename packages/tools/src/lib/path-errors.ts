import { basename, dirname } from "node:path";

const LISTING_CAP = 20;
const SIMILAR_CAP = 5;

/**
 * Build a friendly "path not found" message, optionally enriched with the
 * parent directory's entries and similar names. Pure: takes the entry list
 * (or null), does no I/O.
 */
export function buildPathNotFoundMessage(
  searchPath: string,
  parentEntries: string[] | null,
): string {
  let msg = `Path not found: ${searchPath}`;
  if (!parentEntries || parentEntries.length === 0) return msg;

  const base = basename(searchPath).toLowerCase();
  const listing = parentEntries.slice(0, LISTING_CAP);
  const overflow = parentEntries.length - LISTING_CAP;

  if (base) {
    const similar = parentEntries
      .filter((e) => e.toLowerCase().includes(base))
      .slice(0, SIMILAR_CAP);
    if (similar.length > 0) {
      msg += `\n\nDid you mean: ${similar.map((e) => `'${e}'`).join(", ")}?`;
    }
  }

  const dir = dirname(searchPath);
  msg += `\n\nEntries in ${dir}:\n` + listing.map((e) => `  ${e}`).join("\n");
  if (overflow > 0) {
    msg += `\n  ... (${overflow} more)`;
  }
  return msg;
}
