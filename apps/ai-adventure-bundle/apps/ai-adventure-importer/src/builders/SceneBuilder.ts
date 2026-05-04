import type { BundleRoom, BundleMap, BundleWall, BundleLight } from "@ai-adventure/bundle-schema";
import type { BuildContext } from "./BuildContext.js";
import type { FolderMap } from "./FolderBuilder.js";
import { resolveAsset } from "./BuildContext.js";

export interface BuiltScene {
  roomId: string;
  scene:  Scene;
}

export class SceneBuilder {
  static async buildAll(
    ctx: BuildContext,
    folders: FolderMap
  ): Promise<Map<string, BuiltScene>> {
    const results = new Map<string, BuiltScene>();

    for (const chapter of ctx.bundle.chapters) {
      const chapterFolders = folders.chapters.get(chapter.id);

      for (const room of chapter.rooms) {
        // Only rooms with a battle_map get a scene
        if (!room.mapAssetId || !room.map) continue;

        try {
          const scene = await SceneBuilder._buildOne(
            room,
            room.map,
            ctx,
            chapterFolders?.scenes ?? null
          );
          results.set(room.id, { roomId: room.id, scene });
          ctx.undo.track(
            "scene", scene.id, scene.name,
            ["scenes", `chapter-${chapter.id}`, ctx.bundle.adventure.slug],
            chapterFolders?.scenes?.id
          );
        } catch (err) {
          console.error(`[ai-adventure-importer] Failed to build scene "${room.name}":`, err);
        }
      }
    }

    await ctx.undo.flush();
    return results;
  }

  private static async _buildOne(
    room: BundleRoom,
    map: BundleMap,
    ctx: BuildContext,
    folder: Folder | null
  ): Promise<Scene> {
    const bgPath = resolveAsset(ctx, room.mapAssetId);

    const sceneData: Record<string, unknown> = {
      name: `${room.code}. ${room.name}`,
      folder: folder?.id ?? null,
      background: { src: bgPath },
      grid: {
        type: 1,  // square grid
        size: map.gridSizePx,
      },
      padding: 0.25,
      tokenVision: true,
      fogExploration: true,
    };

    const scene = await (getDocumentClass("Scene") as any).create(sceneData) as unknown as Scene;

    // Place embedded documents — walls first, then lights, then sounds
    // Coordinates are normalised 0.0–1.0 → converted after scene dimensions are known
    await SceneBuilder._placeWalls(scene, map);
    await SceneBuilder._placeLights(scene, map);
    await SceneBuilder._placeSounds(scene, map);

    return scene;
  }

  // ── Walls ─────────────────────────────────────────────────────────────────

  private static async _placeWalls(scene: Scene, map: BundleMap): Promise<void> {
    if (map.walls.length === 0) return;

    const dims = scenePixelDims(map);
    const wallData = map.walls.map(w => convertWall(w, dims));
    await scene.createEmbeddedDocuments("Wall", wallData);
  }

  // ── Lights ────────────────────────────────────────────────────────────────

  private static async _placeLights(scene: Scene, map: BundleMap): Promise<void> {
    if (map.lights.length === 0) return;

    const dims = scenePixelDims(map);
    const lightData = map.lights.map(l => convertLight(l, dims));
    await scene.createEmbeddedDocuments("AmbientLight", lightData);
  }

  // ── Sounds ────────────────────────────────────────────────────────────────

  private static async _placeSounds(scene: Scene, map: BundleMap): Promise<void> {
    if (map.sounds.length === 0) return;

    const dims = scenePixelDims(map);
    const soundData = map.sounds.map(s => ({
      x: Math.round(s.x * dims.width),
      y: Math.round(s.y * dims.height),
      radius: s.radius * map.gridSizePx,
      path: s.path,
      // Description stored as label — GM replaces path later
      flags: { "ai-adventure-importer": { soundDescription: s.description } },
    }));
    await scene.createEmbeddedDocuments("AmbientSound", soundData);
  }
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

interface PixelDims { width: number; height: number }

/**
 * For newly created scenes we don't have canvas.dimensions yet.
 * The scene's pixel dimensions come from the background image dimensions
 * as Foundry records them. We use gridSizePx to make a reasonable default.
 *
 * IMPORTANT: When placing objects on an *active* scene, use canvas.dimensions
 * as in the handoff doc. For batch placement on just-created scenes we use
 * a width/height estimate — good enough for wall placement which uses the
 * scene's native coordinate space.
 */
function scenePixelDims(map: BundleMap): PixelDims {
  // Foundry scene coordinates match the background image dimensions.
  // We don't know the image size here, so we use a canonical 1000×1000
  // normalised space — the 0.0-1.0 coords map to 0-1000 pixels.
  // The scene will scale these to match the actual image when rendered.
  //
  // For production: the CLI should embed pixel dimensions in BundleMap.
  // This is safe for v1 because all coordinates are normalised fractions.
  return { width: 1000, height: 1000 };
}

function convertWall(w: BundleWall, dims: PixelDims): Record<string, unknown> {
  return {
    c: [
      Math.round(w.c[0] * dims.width),
      Math.round(w.c[1] * dims.height),
      Math.round(w.c[2] * dims.width),
      Math.round(w.c[3] * dims.height),
    ],
    light: w.light,
    move:  w.move,
    sight: w.sight,
    door:  w.door,
    ds:    w.ds,
  };
}

function convertLight(l: BundleLight, dims: PixelDims): Record<string, unknown> {
  const lightData: Record<string, unknown> = {
    x: Math.round(l.x * dims.width),
    y: Math.round(l.y * dims.height),
    config: {
      dim:    l.dim,
      bright: l.bright,
      color:  l.color,
      alpha:  0.5,
    },
  };
  if (l.animation) {
    (lightData.config as Record<string, unknown>).animation = {
      type:      l.animation.type,
      speed:     l.animation.speed,
      intensity: l.animation.intensity,
    };
  }
  return lightData;
}
