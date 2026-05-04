/**
 * Bundle Writer
 *
 * Final stage. Takes the fully-populated ExtractedAdventure plus the
 * raw image list and assembles the .bundle ZIP file.
 *
 * Bundle structure:
 *   bundle.json           — full adventure data, validates against bundle-schema
 *   assets/<id>.webp      — binary assets (maps, portraits, handouts)
 *
 * Uses fflate for ZIP assembly (zero-dep, sync-friendly, works in Node).
 * Uses sharp to convert raw image data to WebP.
 */

import { zipSync, strToU8 } from "fflate";
import sharp from "sharp";

import { BUNDLE_SCHEMA_VERSION } from "@ai-adventure/bundle-schema";
import type { ExtractedAdventure, RoomData } from "../pipeline/ContentExtractor.js";
import type { ExtractedImage } from "../pdf/Extractor.js";

export interface BundleWriteOptions {
  system: "pf2e" | "dnd5e" | "generic";
  sourcePdfFilename: string;
}

/**
 * Assemble the bundle ZIP. Returns the ZIP bytes — caller writes to disk.
 */
export async function writeBundle(
  adventure: ExtractedAdventure,
  images: ExtractedImage[],
  opts: BundleWriteOptions
): Promise<Uint8Array> {
  // ── Build the bundle.json structure ──────────────────────────────────
  const bundle = {
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
  };

  // ── Convert and pack images ──────────────────────────────────────────
  // Phase 3a: only include images that are referenced from the adventure
  // (mapAssetId, portraitAssetId, etc.) — avoids dumping every single
  // PDF image in the ZIP.
  const referenced = collectReferencedAssetIds(adventure);
  const assetFiles: Record<string, Uint8Array> = {};

  for (const img of images) {
    if (!referenced.has(img.id)) continue;
    try {
      const webp = await convertToWebp(img);
      assetFiles[`assets/${img.id}.webp`] = webp;
    } catch (err) {
      console.warn(`  ! Failed to convert image ${img.id}: ${(err as Error).message}`);
    }
  }

  // ── Assemble the ZIP ─────────────────────────────────────────────────
  const zipInput: Record<string, Uint8Array> = {
    "bundle.json": strToU8(JSON.stringify(bundle, null, 2)),
    ...assetFiles,
  };

  return zipSync(zipInput, { level: 6 });
}

/**
 * Normalize a chapter to ensure all required arrays/fields exist.
 * Defends against AI responses that omit empty arrays.
 */
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

/**
 * Build the assets manifest: one entry per image referenced by adventure data.
 */
function buildAssetManifest(
  adventure: ExtractedAdventure,
  images: ExtractedImage[]
): Array<{
  id: string;
  type: string;
  filename: string;
  sourcePage: number;
  caption?: string;
}> {
  const referenced = collectReferencedAssetIds(adventure);
  const imagesById = new Map<string, ExtractedImage>();
  for (const img of images) imagesById.set(img.id, img);

  const manifest: Array<{
    id: string;
    type: string;
    filename: string;
    sourcePage: number;
  }> = [];

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

/**
 * Walk the adventure structure and collect every assetId referenced.
 * Includes mapAssetId on rooms, portraitAssetId on NPCs, and assetId on handouts.
 */
function collectReferencedAssetIds(adventure: ExtractedAdventure): Set<string> {
  const ids = new Set<string>();
  for (const ch of adventure.chapters) {
    for (const room of ch.rooms) {
      if (room.mapAssetId) ids.add(room.mapAssetId);
    }
    for (const npc of ch.npcs) {
      if (npc.portraitAssetId) ids.add(npc.portraitAssetId);
    }
    for (const handout of ch.handouts) {
      if (handout.assetId) ids.add(handout.assetId);
    }
  }
  return ids;
}

/**
 * Infer asset type by where the ID is referenced.
 * If an asset is used as a mapAssetId it's a battle_map; portraitAssetId → npc_portrait, etc.
 */
function inferAssetType(assetId: string, adventure: ExtractedAdventure): string {
  for (const ch of adventure.chapters) {
    for (const room of ch.rooms) {
      if (room.mapAssetId === assetId) return "battle_map";
    }
    for (const npc of ch.npcs) {
      if (npc.portraitAssetId === assetId) return "npc_portrait";
    }
    for (const handout of ch.handouts) {
      if (handout.assetId === assetId) return "handout";
    }
  }
  return "scene_illustration";
}

/**
 * Convert raw image data (RGB or RGBA pixel buffer) to a WebP-encoded Uint8Array.
 *
 * Uses sharp's raw-input mode — we already have the decoded pixels from PDF.js,
 * we just need to compress them into WebP. Saves us the trip through PNG.
 */
async function convertToWebp(img: ExtractedImage): Promise<Uint8Array> {
  const buf = await sharp(img.data, {
    raw: {
      width: img.width,
      height: img.height,
      channels: img.channels,
    },
  })
    .webp({ quality: 85, effort: 4 })
    .toBuffer();

  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
