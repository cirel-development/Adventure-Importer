import type { ReadResult } from "../bundle/BundleReader.js";
import type { BuildProgress } from "../apps/BuildStep.js";
import { createBuildContext } from "./BuildContext.js";
import { UndoManager } from "../undo/UndoManager.js";
import { FolderBuilder } from "./FolderBuilder.js";
import { JournalBuilder } from "./JournalBuilder.js";
import { SceneBuilder } from "./SceneBuilder.js";
import { ActorBuilder } from "./ActorBuilder.js";
import { ItemBuilder } from "./ItemBuilder.js";
import { PlaylistBuilder } from "./PlaylistBuilder.js";
import { EntityLinker } from "./EntityLinker.js";
import { clearCache } from "../pf2e/PF2eCompendiumLookup.js";

export type ProgressCallback = (update: Partial<BuildProgress>) => void;

export class BuildPipeline {
  static async run(
    readResult: ReadResult,
    onProgress: ProgressCallback
  ): Promise<UndoManager> {
    const { bundle, assetPaths } = readResult;

    clearCache(); // fresh lookup cache per import

    const undo = UndoManager.createNew(
      crypto.randomUUID(),
      bundle.adventure.title,
      bundle.adventure.slug,
      game.world.id
    );

    const ctx = createBuildContext(bundle, undo, assetPaths);

    const totalPhases = 7;
    let phase = 0;

    function progress(label: string, extra: Partial<BuildProgress> = {}) {
      phase++;
      onProgress({
        phase: extra.phase ?? "folders",
        currentLabel: label,
        done: phase,
        total: totalPhases,
        ...extra,
      });
    }

    try {
      // ── 1. Folders ────────────────────────────────────────────────────────
      progress("Creating folder structure", { phase: "folders" });
      const folders = await FolderBuilder.build(ctx);

      // ── 2. Journals ───────────────────────────────────────────────────────
      progress("Building journals", { phase: "journals" });
      const journals = await JournalBuilder.buildAll(ctx, folders);

      // ── 3. Actors ─────────────────────────────────────────────────────────
      progress("Creating actors", { phase: "actors" });
      const actors = await ActorBuilder.buildAll(ctx, folders);

      // ── 4. Items ──────────────────────────────────────────────────────────
      progress("Creating items", { phase: "items" });
      await ItemBuilder.buildAll(ctx, folders);

      // ── 5. Scenes ─────────────────────────────────────────────────────────
      progress("Building scenes", { phase: "scenes" });
      const scenes = await SceneBuilder.buildAll(ctx, folders);

      // ── 6. Playlists ──────────────────────────────────────────────────────
      progress("Creating playlist scaffolding", { phase: "scenes" });
      await PlaylistBuilder.buildAll(ctx, folders);

      // ── 7. Link @UUID references ──────────────────────────────────────────
      progress("Linking cross-references", { phase: "link" });
      await EntityLinker.link(ctx, journals, actors, scenes);

      await undo.markComplete();
      onProgress({ phase: "done", currentLabel: "Import complete", done: totalPhases, total: totalPhases });

    } catch (err) {
      const msg = (err as Error).message;
      console.error("[ai-adventure-importer] Build failed:", err);
      onProgress({
        phase: "error",
        currentLabel: "Import failed",
        errors: [msg],
      });
      // Flush undo so partial cleanup is possible
      await undo.flush();
    }

    return undo;
  }
}
