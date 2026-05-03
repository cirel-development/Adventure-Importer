/**
 * Content Extractor
 *
 * Stage 2 of content extraction.
 * For each chapter from the outline, asks AI to extract:
 *   - Rooms (with codes, names, read-aloud text, GM notes)
 *   - NPCs (compendium-matched or full custom statblock)
 *   - Encounters (refs to NPCs by ID)
 *   - Items (compendium-matched or custom)
 *   - Hazards (with destination: actor/journal/both)
 *   - Handouts
 *
 * Output is a per-chapter content map, ready for map analysis (next stage).
 */

import type { ExtractionResult } from "../pdf/Extractor.js";
import type { AdventureOutline } from "./OutlineAnalyzer.js";
import { createAiClient } from "../ai/Client.js";

// ── Types matching the bundle schema (loose for now; tightened by writer) ─────

export interface ChapterContent {
  id: string;
  title: string;
  synopsis?: string;
  rooms: RoomData[];
  npcs: NpcData[];
  encounters: EncounterData[];
  items: ItemData[];
  hazards: HazardData[];
  handouts: HandoutData[];
}

export interface RoomData {
  id: string;
  code?: string;
  name: string;
  readAloud?: string;
  gmNotes?: string;
  mapAssetId?: string;
  // map.walls populated by MapAnalyzer in next stage
  map?: { gridSizePx?: number; walls?: unknown[]; lights?: unknown[]; sounds?: unknown[] };
}

export interface NpcData {
  id: string;
  name: string;
  isUnique?: boolean;
  compendiumSlug?: string;
  compendiumName?: string;
  statBlock?: Record<string, unknown>;
  portraitAssetId?: string;
}

export interface EncounterData {
  id: string;
  roomId: string;
  name?: string;
  creatures: Array<{ npcId: string; quantity: number }>;
  difficulty?: string;
}

export interface ItemData {
  id: string;
  name: string;
  quantity: number;
  compendiumSlug?: string;
  custom?: Record<string, unknown>;
  location: "treasure" | "npc-inventory" | "quest-object";
  locationId: string;
}

export interface HazardData {
  id: string;
  name: string;
  roomId: string;
  destination: "actor" | "journal" | "both";
  level?: number;
}

export interface HandoutData {
  id: string;
  name: string;
  type: "image" | "text" | "both";
  content?: string;
  assetId?: string;
}

export interface ExtractedAdventure {
  title: string;
  slug: string;
  synopsis: string;
  tone?: string;
  chapters: ChapterContent[];
}

export interface ContentOptions {
  system: "pf2e" | "dnd5e" | "generic";
  mock: boolean;
  apiKey?: string;
}

/**
 * Run content extraction for every chapter in the outline.
 */
export async function extractContent(
  extracted: ExtractionResult,
  outline: AdventureOutline,
  opts: ContentOptions
): Promise<ExtractedAdventure> {
  const ai = createAiClient({ mock: opts.mock, apiKey: opts.apiKey });

  const chapters: ChapterContent[] = [];

  for (const ch of outline.chapters) {
    const chapterText = extracted.pages
      .filter((p) => p.pageNumber >= ch.startPage && p.pageNumber <= ch.endPage)
      .map((p) => `=== Page ${p.pageNumber} ===\n${p.text}`)
      .join("\n\n");

    const prompt = buildContentPrompt(chapterText, ch, opts);
    const responseText = await ai.generateText({
      prompt,
      system: SYSTEM_PROMPT,
      jsonMode: true,
      maxTokens: 8000,
    });

    const content = parseContentResponse(responseText, ch);
    chapters.push(content);
  }

  return {
    title: outline.title,
    slug: outline.slug,
    synopsis: outline.synopsis,
    tone: outline.tone,
    chapters,
  };
}

const SYSTEM_PROMPT = `You are a tabletop RPG content extractor. Your job is to read adventure text and extract structured data: rooms, NPCs, encounters, items, hazards, and handouts. Output strict JSON only — no preamble, no markdown fences. For PF2e, prefer compendium slugs (e.g. "goblin-warrior", "longsword") over custom statblocks when the creature/item exists in standard sources.`;

function buildContentPrompt(
  chapterText: string,
  chapter: { id: string; title: string; startPage: number; endPage: number },
  opts: ContentOptions
): string {
  return `[MOCK:content]
Extract structured content from this ${opts.system.toUpperCase()} chapter.

Chapter: "${chapter.title}" (pages ${chapter.startPage}-${chapter.endPage})

Output JSON in this shape:
{
  "rooms": [{ "id": "kebab-id", "code": "A1", "name": "...", "readAloud": "<HTML>", "gmNotes": "<HTML>" }],
  "npcs": [{ "id": "kebab-id", "name": "...", "isUnique": false, "compendiumSlug": "..." }],
  "encounters": [{ "id": "kebab-id", "roomId": "...", "creatures": [{ "npcId": "...", "quantity": 1 }] }],
  "items": [{ "id": "kebab-id", "name": "...", "quantity": 1, "compendiumSlug": "...", "location": "treasure", "locationId": "room-id" }],
  "hazards": [{ "id": "kebab-id", "name": "...", "roomId": "...", "destination": "both" }],
  "handouts": [{ "id": "kebab-id", "name": "...", "type": "text", "content": "<HTML>" }]
}

Rules:
- All IDs must be kebab-case and unique within their array.
- For NPCs that exist in standard PF2e compendiums (Bestiary 1-3, Monster Core, NPC Core), use compendiumSlug only.
- For unique named NPCs, set isUnique: true and include a full statBlock.
- Items follow same rule: standard items get compendiumSlug, custom items get a custom block.

Chapter text:
${chapterText}`;
}

function parseContentResponse(
  raw: string,
  chapter: { id: string; title: string; synopsis?: string }
): ChapterContent {
  const parsed = safeJsonParse(raw);

  return {
    id: chapter.id,
    title: chapter.title,
    synopsis: chapter.synopsis,
    rooms: Array.isArray(parsed.rooms) ? (parsed.rooms as RoomData[]) : [],
    npcs: Array.isArray(parsed.npcs) ? (parsed.npcs as NpcData[]) : [],
    encounters: Array.isArray(parsed.encounters) ? (parsed.encounters as EncounterData[]) : [],
    items: Array.isArray(parsed.items) ? (parsed.items as ItemData[]) : [],
    hazards: Array.isArray(parsed.hazards) ? (parsed.hazards as HazardData[]) : [],
    handouts: Array.isArray(parsed.handouts) ? (parsed.handouts as HandoutData[]) : [],
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
