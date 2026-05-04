import type { AdventureBundle } from "@ai-adventure/bundle-schema";
import type { UndoManager } from "../undo/UndoManager.js";
import { MODULE_ID, SETTINGS } from "../constants.js";

/**
 * Shared context threaded through every builder.
 * Created once at the start of a build run.
 */
export interface BuildContext {
  bundle:      AdventureBundle;
  undo:        UndoManager;
  /** Foundry-relative paths keyed by AssetManifest.id */
  assetPaths:  Map<string, string>;
  /** Top-level folder name from settings, e.g. "AI Imported" */
  rootFolder:  string;
  /** Foundry world id — used for undo manifest path */
  worldId:     string;
  /** Placeholder image when an asset is missing */
  missingImg:  string;
}

export function createBuildContext(
  bundle: AdventureBundle,
  undo: UndoManager,
  assetPaths: Map<string, string>
): BuildContext {
  return {
    bundle,
    undo,
    assetPaths,
    rootFolder: game.settings.get<string>(MODULE_ID, SETTINGS.FOLDER_NAME) ?? "AI Imported",
    worldId: game.world.id,
    missingImg: "icons/svg/mystery-man.svg",
  };
}

/** Resolve an asset id to a Foundry-relative path, or the missing placeholder. */
export function resolveAsset(ctx: BuildContext, assetId: string | undefined): string {
  if (!assetId) return ctx.missingImg;
  return ctx.assetPaths.get(assetId) ?? ctx.missingImg;
}
