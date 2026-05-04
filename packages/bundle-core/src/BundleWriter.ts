/**
 * Bundle Writer (shared, used by CLI and MCP server)
 *
 * Takes a fully-assembled adventure object plus a map of asset bytes
 * and produces a .bundle ZIP file.
 *
 * Where the JSON came from (mock pipeline, real Claude API, MCP server)
 * is irrelevant — this just packs it.
 */

import { zipSync, strToU8 } from "fflate";
import sharp from "sharp";

import { BUNDLE_SCHEMA_VERSION, AdventureBundleSchema } from "@ai-adventure/bundle-schema";
import type { AdventureBundle } from "@ai-adventure/bundle-schema";

export interface BundleAssetSource {
  /** Asset id used in the bundle JSON (matches assets[].id). */
  id: string;
  /** Raw image bytes — any format Sharp can read, or already-encoded WebP. */
  bytes: Uint8Array;
  /** If bytes is raw pixel data, supply width/height/channels for re-encoding. */
  raw?: { width: number; height: number; channels: 3 | 4 };
  /** Skip Sharp re-encode; bytes are already a valid image format. */
  preEncoded?: boolean;
}

export interface BundleWriteResult {
  /** ZIP bytes ready to write to disk. */
  zipBytes: Uint8Array;
  /** Validation issues from Zod, if any (warnings, not errors). */
  warnings: string[];
}

/**
 * Assemble a .bundle ZIP from a complete adventure object plus asset sources.
 *
 * The adventure object should validate against AdventureBundleSchema.
 * If it doesn't, we still write the ZIP but include warnings — the caller
 * decides whether to surface them.
 */
export async function writeBundle(
  bundle: AdventureBundle,
  assets: BundleAssetSource[] = []
): Promise<BundleWriteResult> {
  const warnings: string[] = [];

  // Validate first — but don't throw, just collect warnings
  const validation = AdventureBundleSchema.safeParse(bundle);
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      warnings.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  // Force the schema field to match this build
  const finalBundle: AdventureBundle = {
    ...bundle,
    schema: BUNDLE_SCHEMA_VERSION,
  };

  // ── Convert and pack assets ───────────────────────────────────────────
  const referenced = collectReferencedAssetIds(finalBundle);
  const assetFiles: Record<string, Uint8Array> = {};

  for (const source of assets) {
    if (!referenced.has(source.id)) {
      warnings.push(`asset "${source.id}" provided but not referenced in bundle`);
      continue;
    }
    try {
      const webp = await encodeAsset(source);
      assetFiles[`assets/${source.id}.webp`] = webp;
    } catch (err) {
      warnings.push(`failed to encode asset "${source.id}": ${(err as Error).message}`);
    }
  }

  // Warn about referenced assets we don't have bytes for
  const provided = new Set(assets.map((a) => a.id));
  for (const id of referenced) {
    if (!provided.has(id)) {
      warnings.push(`asset "${id}" referenced but not provided — placeholder will be used`);
    }
  }

  // ── Build the ZIP ─────────────────────────────────────────────────────
  const zipInput: Record<string, Uint8Array> = {
    "bundle.json": strToU8(JSON.stringify(finalBundle, null, 2)),
    ...assetFiles,
  };

  const zipBytes = zipSync(zipInput, { level: 6 });
  return { zipBytes, warnings };
}

/**
 * Walk the adventure structure and collect every asset ID referenced
 * by rooms (mapAssetId), NPCs (portraitAssetId), and handouts (assetId).
 */
function collectReferencedAssetIds(bundle: AdventureBundle): Set<string> {
  const ids = new Set<string>();
  for (const ch of bundle.chapters) {
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
 * Encode an asset to WebP. Three input modes:
 *   - preEncoded=true → bytes are already valid PNG/JPEG/WebP, decode and re-encode to WebP
 *   - raw provided   → bytes are raw pixel buffer at given width/height/channels
 *   - neither        → assume bytes are some image format, let Sharp auto-detect
 */
async function encodeAsset(source: BundleAssetSource): Promise<Uint8Array> {
  const pipeline = source.raw
    ? sharp(source.bytes, {
        raw: {
          width: source.raw.width,
          height: source.raw.height,
          channels: source.raw.channels,
        },
      })
    : sharp(source.bytes);

  const buf = await pipeline.webp({ quality: 85, effort: 4 }).toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
