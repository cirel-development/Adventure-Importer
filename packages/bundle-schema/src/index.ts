import { z } from "zod";

// ── Schema version ───────────────────────────────────────────────────────────
// Bump minor for additive (backwards-compatible) changes.
// Bump major for breaking changes — importer must reject mismatched majors.
export const BUNDLE_SCHEMA_VERSION = "1.0";

// ── Primitives ───────────────────────────────────────────────────────────────

const Slug = z.string().regex(/^[a-z0-9-]+$/, "must be kebab-case");
const Html = z.string(); // HTML string — no structural validation
const NormCoord = z.number().min(0).max(1); // normalised 0.0–1.0 map coordinate

// ── Meta ─────────────────────────────────────────────────────────────────────

export const BundleMetaSchema = z.object({
  generatedAt: z.string().datetime(),
  generatedBy: z.string(), // e.g. "ai-adventure-bundle-cli/1.0.0"
  sourcePdf: z.string(),   // original filename, display only
  system: z.enum(["pf2e", "dnd5e", "generic"]),
});
export type BundleMeta = z.infer<typeof BundleMetaSchema>;

// ── Adventure info ────────────────────────────────────────────────────────────

export const AdventureInfoSchema = z.object({
  title: z.string(),
  slug: Slug,
  synopsis: z.string(),
  tone: z.string().optional(),
  partyLevel: z.object({ min: z.number(), max: z.number() }).optional(),
  partySize: z.number().optional(),
});
export type AdventureInfo = z.infer<typeof AdventureInfoSchema>;

// ── Assets ────────────────────────────────────────────────────────────────────

export const AssetTypeSchema = z.enum([
  "battle_map",
  "area_map",
  "npc_portrait",
  "creature_art",
  "item_art",
  "scene_illustration",
  "handout",
]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetManifestSchema = z.object({
  id: Slug,
  type: AssetTypeSchema,
  filename: z.string(), // path within assets/ in the ZIP
  sourcePage: z.number().int().positive(),
  caption: z.string().optional(),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

// ── Map data ──────────────────────────────────────────────────────────────────

const WallValue = z.union([z.literal(0), z.literal(10), z.literal(20)]);

export const BundleWallSchema = z.object({
  // Normalised 0.0–1.0 — importer converts to scene pixels at import time
  c: z.tuple([NormCoord, NormCoord, NormCoord, NormCoord]),
  light: WallValue,
  move: WallValue,
  sight: WallValue,
  door: z.union([z.literal(0), z.literal(1), z.literal(2)]), // 0=wall,1=door,2=secret
  ds: z.union([z.literal(0), z.literal(1), z.literal(2)]),   // 0=closed,1=open,2=locked
});
export type BundleWall = z.infer<typeof BundleWallSchema>;

export const BundleLightSchema = z.object({
  x: NormCoord,
  y: NormCoord,
  dim: z.number(),    // grid units
  bright: z.number(), // grid units
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  animation: z.object({
    type: z.string(),
    speed: z.number(),
    intensity: z.number(),
  }).optional(),
});
export type BundleLight = z.infer<typeof BundleLightSchema>;

export const BundleAmbientSoundSchema = z.object({
  x: NormCoord,
  y: NormCoord,
  radius: z.number(), // grid units
  path: z.string(),   // Foundry-relative sound path (GM fills in after import)
  description: z.string(),
});
export type BundleAmbientSound = z.infer<typeof BundleAmbientSoundSchema>;

export const BundleMapSchema = z.object({
  gridSizePx: z.number().int().positive(),
  walls: z.array(BundleWallSchema),
  lights: z.array(BundleLightSchema),
  sounds: z.array(BundleAmbientSoundSchema),
});
export type BundleMap = z.infer<typeof BundleMapSchema>;

// ── Stat block ────────────────────────────────────────────────────────────────

export const BundleStrikeSchema = z.object({
  name: z.string(),
  type: z.enum(["melee", "ranged"]),
  attack: z.number().int(),
  damage: z.string(), // e.g. "2d8+6 slashing"
  traits: z.array(z.string()),
  range: z.number().optional(), // grid units, ranged only
});
export type BundleStrike = z.infer<typeof BundleStrikeSchema>;

const ActionCostSchema = z.union([
  z.literal("passive"),
  z.literal("free"),
  z.literal("reaction"),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const BundleActionSchema = z.object({
  name: z.string(),
  cost: ActionCostSchema,
  traits: z.array(z.string()),
  description: Html,
  trigger: z.string().optional(),
  frequency: z.object({
    count: z.number().int().positive(),
    per: z.enum(["round", "turn", "day", "encounter", "hour", "week", "minute"]),
  }).optional(),
  compendiumSlug: Slug.optional(), // if found in pf2e.actionspf2e
});
export type BundleAction = z.infer<typeof BundleActionSchema>;

export const BundleSpellSchema = z.object({
  name: z.string(),
  level: z.number().int().min(0).max(10),
  heightenedLevel: z.number().int().min(0).max(10).optional(),
  frequency: z.object({
    type: z.enum(["at-will", "per-day", "constant", "one-time"]),
    count: z.number().int().positive().optional(), // only for per-day
  }).optional(),
  compendiumSlug: Slug.optional(), // absent = importer creates stub
});
export type BundleSpell = z.infer<typeof BundleSpellSchema>;

export const BundleSpellcastingSchema = z.object({
  type: z.enum(["innate", "prepared", "spontaneous", "focus", "ritual"]),
  tradition: z.enum(["arcane", "divine", "occult", "primal"]),
  dc: z.number().int(),
  attack: z.number().int().optional(),
  spells: z.array(BundleSpellSchema),
});
export type BundleSpellcasting = z.infer<typeof BundleSpellcastingSchema>;

export const BundleStatBlockSchema = z.object({
  level: z.number().int(),
  traits: z.array(z.string()),
  size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]),
  rarity: z.enum(["common", "uncommon", "rare", "unique"]),

  hp: z.number().int().positive(),
  immunities: z.array(z.string()),
  weaknesses: z.array(z.object({ type: z.string(), value: z.number().int() })),
  resistances: z.array(z.object({ type: z.string(), value: z.number().int() })),

  ac: z.number().int(),
  saves: z.object({
    fort: z.number().int(),
    ref: z.number().int(),
    will: z.number().int(),
  }),
  abilities: z.object({
    str: z.number().int(),
    dex: z.number().int(),
    con: z.number().int(),
    int: z.number().int(),
    wis: z.number().int(),
    cha: z.number().int(),
  }),

  perception: z.number().int(),
  senses: z.array(z.string()),
  languages: z.array(z.string()),
  skills: z.record(z.string(), z.number().int()),

  speeds: z.object({
    land: z.number().int(),
    fly: z.number().int().optional(),
    swim: z.number().int().optional(),
    climb: z.number().int().optional(),
    burrow: z.number().int().optional(),
  }),

  strikes: z.array(BundleStrikeSchema),
  actions: z.array(BundleActionSchema),
  spellcasting: z.array(BundleSpellcastingSchema),

  // 0.0–1.0. Importer shows warning below 0.6, routes to _Review Needed below that.
  confidenceScore: z.number().min(0).max(1),
});
export type BundleStatBlock = z.infer<typeof BundleStatBlockSchema>;

// ── NPCs ──────────────────────────────────────────────────────────────────────

export const BundleNPCSchema = z.object({
  id: Slug,
  name: z.string(),
  isUnique: z.boolean(),

  // Importer tries compendium first; falls back to statBlock if absent or no match
  compendiumSlug: Slug.optional(),
  compendiumName: z.string().optional(),

  // Populated by processor when no compendium match found
  statBlock: BundleStatBlockSchema.optional(),

  portraitAssetId: Slug.optional(),
  personality: z.string().optional(),
  publicKnowledge: Html.optional(),
  secrets: Html.optional(),    // GM only
  tactics: Html.optional(),    // GM only
  voiceNotes: z.string().optional(),
});
export type BundleNPC = z.infer<typeof BundleNPCSchema>;

// ── Rooms ─────────────────────────────────────────────────────────────────────

export const RoomConnectionSchema = z.object({
  toRoomId: Slug,
  direction: z.string().optional(),
  description: z.string(),
  requirement: z.string().optional(),
});

export const SkillCheckSchema = z.object({
  skill: z.string(),
  dc: z.number().int(),
  description: z.string(),
  success: z.string().optional(),
  failure: z.string().optional(),
});

export const RoomAmbienceSchema = z.object({
  background: z.array(z.string()),
  combatTrack: z.string().optional(),
  oneShots: z.array(z.string()).optional(),
});

export const BundleRoomSchema = z.object({
  id: Slug,
  code: z.string(), // "A1"
  name: z.string(),
  readAloud: Html.optional(),
  gmNotes: Html.optional(),
  connections: z.array(RoomConnectionSchema),
  skillChecks: z.array(SkillCheckSchema),
  mapAssetId: Slug.optional(),
  map: BundleMapSchema.optional(), // present when mapAssetId is a battle_map
  ambience: RoomAmbienceSchema.optional(),
});
export type BundleRoom = z.infer<typeof BundleRoomSchema>;

// ── Encounters ────────────────────────────────────────────────────────────────

export const BundleEncounterSchema = z.object({
  id: Slug,
  roomId: Slug,
  name: z.string().optional(),
  creatures: z.array(z.object({
    npcId: Slug,
    quantity: z.number().int().positive(),
  })),
  difficulty: z.enum(["trivial", "low", "moderate", "severe", "extreme"]).optional(),
  tactics: z.string().optional(),
  xpBudget: z.number().int().optional(),
});
export type BundleEncounter = z.infer<typeof BundleEncounterSchema>;

// ── Items ─────────────────────────────────────────────────────────────────────

export const BundleCustomItemSchema = z.object({
  type: z.enum(["weapon", "armor", "equipment", "consumable", "treasure"]),
  level: z.number().int(),
  rarity: z.enum(["common", "uncommon", "rare", "unique"]),
  traits: z.array(z.string()),
  bulk: z.number(),
  price: z.object({ gp: z.number().optional(), sp: z.number().optional() }).optional(),
  description: Html,
  confidenceScore: z.number().min(0).max(1),
});

export const BundleItemSchema = z.object({
  id: Slug,
  name: z.string(),
  quantity: z.number().int().positive(),

  // Routing — importer uses the first that applies:
  compendiumSlug: Slug.optional(),           // direct link
  baseSlug: Slug.optional(),                 // base item for rune application
  runes: z.array(z.string()).optional(),     // e.g. ["potency-1", "striking"]
  custom: BundleCustomItemSchema.optional(), // only when no compendium match

  location: z.enum(["treasure", "npc-inventory", "quest-object"]),
  locationId: Slug, // roomId or npcId
  imageAssetId: Slug.optional(),
});
export type BundleItem = z.infer<typeof BundleItemSchema>;

// ── Hazards ───────────────────────────────────────────────────────────────────

export const BundleHazardSchema = z.object({
  id: Slug,
  name: z.string(),
  roomId: Slug,
  destination: z.enum(["actor", "journal", "both"]),

  // Actor path (combat-relevant)
  level: z.number().int().optional(),
  traits: z.array(z.string()).optional(),
  stealth: z.object({ dc: z.number().int(), minProf: z.string().optional() }).optional(),
  disable: z.object({
    dc: z.number().int(),
    skill: z.string(),
    description: z.string(),
  }).optional(),
  actions: z.array(BundleActionSchema).optional(),
  hp: z.number().int().optional(),
  ac: z.number().int().optional(),
  saves: z.object({
    fort: z.number().int().optional(),
    ref: z.number().int().optional(),
    will: z.number().int().optional(),
  }).optional(),
  description: Html.optional(),

  gmNotes: Html, // always present — journal path
});
export type BundleHazard = z.infer<typeof BundleHazardSchema>;

// ── Handouts ──────────────────────────────────────────────────────────────────

export const BundleHandoutSchema = z.object({
  id: Slug,
  name: z.string(),
  type: z.enum(["image", "text", "both"]),
  assetId: Slug.optional(),
  content: Html.optional(),
  foundLocation: z.string().optional(),
});
export type BundleHandout = z.infer<typeof BundleHandoutSchema>;

// ── Chapter ───────────────────────────────────────────────────────────────────

export const BundleChapterSchema = z.object({
  id: Slug,
  title: z.string(),
  synopsis: z.string().optional(),
  rooms: z.array(BundleRoomSchema),
  npcs: z.array(BundleNPCSchema),
  encounters: z.array(BundleEncounterSchema),
  items: z.array(BundleItemSchema),
  hazards: z.array(BundleHazardSchema),
  handouts: z.array(BundleHandoutSchema),
});
export type BundleChapter = z.infer<typeof BundleChapterSchema>;

// ── Root ──────────────────────────────────────────────────────────────────────

export const AdventureBundleSchema = z.object({
  schema: z.string(), // "1.0"
  meta: BundleMetaSchema,
  adventure: AdventureInfoSchema,
  assets: z.array(AssetManifestSchema),
  chapters: z.array(BundleChapterSchema),
});
export type AdventureBundle = z.infer<typeof AdventureBundleSchema>;

// ── Compendium index (exported by the Foundry module) ────────────────────────

export const PackIndexSchema = z.object({
  id: z.string(),    // e.g. "pf2e.pathfinder-bestiary"
  slugs: z.array(z.string()),
});

export const CompendiumIndexSchema = z.object({
  exportedAt: z.string().datetime(),
  worldId: z.string(),
  packs: z.array(PackIndexSchema),
});
export type CompendiumIndex = z.infer<typeof CompendiumIndexSchema>;
export type PackIndex = z.infer<typeof PackIndexSchema>;

// ── Validation helpers ────────────────────────────────────────────────────────

export function parseBundle(raw: unknown): AdventureBundle {
  return AdventureBundleSchema.parse(raw);
}

/** Returns the major version string — "1" from "1.0" */
export function schemaMajor(version: string): string {
  return version.split(".")[0];
}

export function isSchemaMajorCompatible(bundleVersion: string): boolean {
  return schemaMajor(bundleVersion) === schemaMajor(BUNDLE_SCHEMA_VERSION);
}
