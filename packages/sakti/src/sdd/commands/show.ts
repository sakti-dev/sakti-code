import {
  resolveRootForCommand,
  toRootOutput,
  type ResolvedSaktiRoot,
  type RootOutput,
} from "../core/root-selection.js";
import { ChangeCommand } from "./change.js";
import { SpecCommand } from "./spec.js";
import { getActiveChangeIds, getSpecIds } from "../utils/item-discovery.js";
import { nearestMatches } from "../utils/match.js";

type ItemType = "change" | "spec";

const CHANGE_FLAG_KEYS = new Set(["deltasOnly", "requirementsOnly"]);
const SPEC_FLAG_KEYS = new Set(["requirements", "scenarios", "requirement"]);

interface ShowExecuteOptions {
  json?: boolean;
  type?: string;
  [k: string]: any;
}

export class ShowCommand {
  async execute(itemName?: string, options: ShowExecuteOptions = {}): Promise<void> {
    const root = await resolveRootForCommand({ json: options.json });
    if (!root) {
      return;
    }

    if (!itemName) {
      console.error("Item name required. Usage: sakti show <item-name>");
      process.exitCode = 1;
      return;
    }

    const typeOverride = this.normalizeType(options.type);
    await this.showDirect(itemName, { typeOverride, options, root });
  }

  private normalizeType(value?: string): ItemType | undefined {
    if (!value) return undefined;
    const v = value.toLowerCase();
    if (v === "change" || v === "spec") return v;
    return undefined;
  }

  private delegateOptions(
    root: ResolvedSaktiRoot,
    options: ShowExecuteOptions,
  ): ShowExecuteOptions & { rootOutput?: RootOutput } {
    return {
      ...options,
      ...(options.json ? { rootOutput: toRootOutput(root) } : {}),
    };
  }

  private async showDirect(
    itemName: string,
    params: { typeOverride?: ItemType; options: ShowExecuteOptions; root: ResolvedSaktiRoot },
  ): Promise<void> {
    const root = params.root;
    // Optimize lookups when type is pre-specified
    let isChange = false;
    let isSpec = false;
    let changes: string[] = [];
    let specs: string[] = [];
    if (params.typeOverride === "change") {
      changes = await getActiveChangeIds(root.path);
      isChange = changes.includes(itemName);
    } else if (params.typeOverride === "spec") {
      specs = await getSpecIds(root.path);
      isSpec = specs.includes(itemName);
    } else {
      [changes, specs] = await Promise.all([getActiveChangeIds(root.path), getSpecIds(root.path)]);
      isChange = changes.includes(itemName);
      isSpec = specs.includes(itemName);
    }

    const resolvedType = params.typeOverride ?? (isChange ? "change" : isSpec ? "spec" : undefined);

    if (!resolvedType) {
      const suggestions = nearestMatches(itemName, [...changes, ...specs]);
      const message = suggestions.length
        ? `Unknown item '${itemName}'. Did you mean: ${suggestions.join(", ")}?`
        : `Unknown item '${itemName}'.`;
      if (params.options.json) {
        console.log(
          JSON.stringify(
            { status: [{ severity: "error", code: "unknown_item", message }] },
            null,
            2,
          ),
        );
      } else {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }

    if (!params.typeOverride && isChange && isSpec) {
      if (params.options.json) {
        console.log(
          JSON.stringify(
            {
              status: [
                {
                  severity: "error",
                  code: "ambiguous_item",
                  message: `Ambiguous item '${itemName}' matches both a change and a spec.`,
                  fix: "Pass --type change|spec.",
                },
              ],
            },
            null,
            2,
          ),
        );
        process.exitCode = 1;
        return;
      }
      console.error(`Ambiguous item '${itemName}' matches both a change and a spec.`);
      console.error("Pass --type change|spec, or use: sakti change show / sakti spec show");
      process.exitCode = 1;
      return;
    }

    this.warnIrrelevantFlags(resolvedType, params.options);
    if (resolvedType === "change") {
      const cmd = new ChangeCommand(root.path);
      await cmd.show(itemName, this.delegateOptions(root, params.options) as any);
      return;
    }
    const cmd = new SpecCommand(root.path);
    await cmd.show(itemName, this.delegateOptions(root, params.options) as any);
  }

  private warnIrrelevantFlags(type: ItemType, options: { [k: string]: any }): boolean {
    const irrelevant: string[] = [];
    if (type === "change") {
      for (const k of SPEC_FLAG_KEYS) if (k in options) irrelevant.push(k);
    } else {
      for (const k of CHANGE_FLAG_KEYS) if (k in options) irrelevant.push(k);
    }
    if (irrelevant.length > 0) {
      console.error(`Warning: Ignoring flags not applicable to ${type}: ${irrelevant.join(", ")}`);
      return true;
    }
    return false;
  }
}
