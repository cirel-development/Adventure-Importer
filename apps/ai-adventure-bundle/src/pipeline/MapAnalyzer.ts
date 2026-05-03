/**
 * Map Analyzer
 *
 * Stage 3 of content extraction.
 * For each room with a battle-map image, asks vision AI to detect:
 *   - Wall coordinates (normalised 0.0-1.0)
 *   - Door positions
 *   - Suggested light placements
 *
 * Output is the same ExtractedAdventure structure, but with room.map.walls
 * populated from vision analysis.
 *
 * In Phase 3a (mock mode), every room gets the same canned wall set
 * (a simple rectangle outline) so the importer can prove walls land correctly.
 */

import type { ExtractionResult, ExtractedImage } from "../pdf/Extractor.js";
import type { ExtractedAdventure } from "./ContentExtractor.js";
import { createAiClient } from "../ai/Client.js";

export interface MapOptions {
  mock: boolean;
  apiKey?: string;
}

/**
 * Analyse maps for every room that has a mapAssetId.
 * Returns a new ExtractedAdventure with map.walls etc. populated.
 */
export async function analyzeMaps(
  adventure: ExtractedAdventure,
  extracted: ExtractionResult,
  opts: MapOptions
): Promise<ExtractedAdventure> {
  const ai = createAiClient({ mock: opts.mock, apiKey: opts.apiKey });

  // Build an index of images for quick lookup
  const imagesById = new Map<string, ExtractedImage>();
  for (const img of extracted.images) imagesById.set(img.id, img);

  const enrichedChapters = await Promise.all(
    adventure.chapters.map(async (ch) => {
      const enrichedRooms = await Promise.all(
        ch.rooms.map(async (room) => {
          if (!room.mapAssetId) return room;

          // Find the image bytes for this map. In mock mode the assetId
          // may not exist in extracted.images yet — that's fine, mock
          // still returns canned walls.
          const img = imagesById.get(room.mapAssetId);
          const mapData = await analyseMapImage(ai, img, room.name, opts);

          return {
            ...room,
            map: { ...(room.map ?? {}), ...mapData },
          };
        })
      );
      return { ...ch, rooms: enrichedRooms };
    })
  );

  return { ...adventure, chapters: enrichedChapters };
}

interface MapAnalysisResult {
  gridSizePx?: number;
  walls: unknown[];
  lights: unknown[];
  sounds: unknown[];
}

async function analyseMapImage(
  ai: ReturnType<typeof createAiClient>,
  img: ExtractedImage | undefined,
  roomName: string,
  _opts: MapOptions
): Promise<MapAnalysisResult> {
  // In mock mode we don't actually need image bytes — the marker in the
  // prompt triggers a canned response. In live mode this will fail
  // gracefully and return empty walls if the image is missing.
  const prompt = buildMapPrompt(roomName);

  let responseText: string;
  if (img) {
    responseText = await ai.generateVision({
      prompt,
      imageBytes: img.data,
      mimeType: "image/png", // mock client ignores; live will need real conversion
      jsonMode: true,
    });
  } else {
    responseText = await ai.generateText({
      prompt,
      jsonMode: true,
    });
  }

  return parseMapResponse(responseText);
}

function buildMapPrompt(roomName: string): string {
  return `[MOCK:map_walls]
Analyse this battle map for "${roomName}".

Identify:
1. Wall segments — positions in normalised 0.0-1.0 coordinates (0,0 = top-left of image).
2. Door positions — same coords, marked with door=1 (or 2 for secret doors).
3. Suggested light source positions for torches/braziers if visible.

Output JSON:
{
  "gridSizePx": 100,
  "walls": [
    { "c": [x1, y1, x2, y2], "light": 20, "move": 20, "sight": 20, "door": 0, "ds": 0 }
  ],
  "lights": [
    { "x": 0.5, "y": 0.5, "dim": 4, "bright": 2, "color": "#ff9329" }
  ],
  "sounds": []
}

Wall flags: light/move/sight = 0 (none) or 20 (normal block). door = 0 (wall) or 1 (door) or 2 (secret).`;
}

function parseMapResponse(raw: string): MapAnalysisResult {
  const parsed = safeJsonParse(raw);

  return {
    gridSizePx: typeof parsed.gridSizePx === "number" ? parsed.gridSizePx : 100,
    walls: Array.isArray(parsed.walls) ? parsed.walls : [],
    lights: Array.isArray(parsed.lights) ? parsed.lights : [],
    sounds: Array.isArray(parsed.sounds) ? parsed.sounds : [],
  };
}

function safeJsonParse(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
