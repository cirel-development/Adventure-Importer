/**
 * Bundle Writer (CLI adapter)
 *
 * Adapts the pipeline's loose ExtractedAdventure shape into a properly
 * structured AdventureBundle, then delegates to @ai-adventure/bundle-core.
 *
 * The pipeline produces less-strict types (rooms missing required arrays,
 * etc.) — this layer normalises them before validation.
 */

import { writeBundle as coreWriteBundle, type BundleAssetSource } from "@ai-adventure/bundle-core";
import {
  BUNDLE_SCHEMA_VERSION,
  type AdventureBundle,
} from "@ai-adventure/bundle-schema";
import type { ExtractedImage } from "@ai-adventure/bundle-core";
import type { ExtractedAdventure, RoomData } from "../pipeline/ContentExtractor.js";

export interface BundleWriteOptions {
  system: "pf2e" | "dnd5e" | "generic";
  sourcePdfFilename: string;
}

export async function writeBundle(
  adventure: ExtractedAdventure,
  images: ExtractedImage[],
  opts: BundleWriteOptions
): Promise<Uint8Array> {
  const bundle: AdventureBundle = {
    schema: BUNDLE_SCHEMA_VERSION,
    meta: {
      generatedAt: new Date().toISOString(),
      generatedBy: "ai-adventure-bundle-cli/0.1.0",
      sourcePdf: opts.sourcePdfFilename,
      system: opts.system,
    },
    adventure: {
      title: adventure.title,
      slug: adventure.slug,
      synopsis: adventure.synopsis,
      tone: adventure.tone,
    },
    assets: buildAssetManifest(adventure, images),
    chapters: adventure.chapters.map(normaliseChapter),
  } as AdventureBundle;

  const referenced = collectReferencedAssetIds(bundle);
  const sources: BundleAssetSource[] = images
    .filter((img) => referenced.has(img.id))
    .map((img) => ({
      id: img.id,
      bytes: img.data,
      raw: { width: img.width, height: img.height, channels: img.channels },
    }));

  const { zipBytes, warnings } = await coreWriteBundle(bundle, sources);
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`  ! ${w}`);
  }
  return zipBytes;
}

function normaliseChapter(ch: ExtractedAdventure["chapters"][number]) {
  return {
    ...ch,
    rooms: ch.rooms.map((room) => {
      const r = room as RoomData & { connections?: unknown[]; skillChecks?: unknown[] };
      return {
        ...r,
        connections: Array.isArray(r.connections) ? r.connections : [],
        skillChecks: Array.isArray(r.skillChecks) ? r.skillChecks : [],
      };
    }),
  };
}

function buildAssetManifest(
  adventure: ExtractedAdventure,
  images: ExtractedImage[]
): AdventureBundle["assets"] {
  const referenced = new Set<string>();
  for (const ch of adventure.chapters) {
    for (const room of ch.rooms) if (room.mapAssetId) referenced.add(room.mapAssetId);
    for (const npc of ch.npcs) if (npc.portraitAssetId) referenced.add(npc.portraitAssetId);
    for (const handout of ch.handouts) if (handout.assetId) referenced.add(handout.assetId);
  }

  const imagesById = new Map(images.map((i) => [i.id, i]));
  const manifest: AdventureBundle["assets"] = [];

  for (const id of referenced) {
    const img = imagesById.get(id);
    manifest.push({
      id,
      type: inferAssetType(id, adventure),
      filename: `${id}.webp`,
      sourcePage: img?.pageNumber ?? 1,
    });
  }
  return manifest;
}

function collectReferencedAssetIds(bundle: AdventureBundle): Set<string> {
  const ids = new Set<string>();
  for (const ch of bundle.chapters) {
    for (const room of ch.rooms) if (room.mapAssetId) ids.add(room.mapAssetId);
    for (const npc of ch.npcs) if (npc.portraitAssetId) ids.add(npc.portraitAssetId);
    for (const handout of ch.handouts) if (handout.assetId) ids.add(handout.assetId);
  }
  return ids;
}

function inferAssetType(
  id: string,
  adventure: ExtractedAdventure
): AdventureBundle["assets"][number]["type"] {
  for (const ch of adventure.chapters) {
    for (const room of ch.rooms) if (room.mapAssetId === id) return "battle_map";
    for (const npc of ch.npcs) if (npc.portraitAssetId === id) return "npc_portrait";
    for (const handout of ch.handouts) if (handout.assetId === id) return "handout";
  }
  return "scene_illustration";
}
