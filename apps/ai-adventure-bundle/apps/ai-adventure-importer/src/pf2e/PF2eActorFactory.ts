import type { BundleNPC, BundleStatBlock } from "@ai-adventure/bundle-schema";
import { lookupSpell, lookupAction } from "./PF2eCompendiumLookup.js";
import { CONFIDENCE } from "../constants.js";

// Size → token dimensions
const SIZE_DIMENSIONS: Record<string, number> = {
  tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4,
};

export interface BuiltActorData {
  data: Record<string, unknown>;
  /** Spells to create as embedded Items after actor exists */
  spells: SpellEmbedData[];
  /** Actions to create as embedded Items */
  actions: ActionEmbedData[];
  /** Spells that couldn't be resolved — stub text for GM */
  unresolvedSpells: string[];
}

interface SpellEmbedData {
  compendiumId?: string;
  packId?: string;
  stub?: Record<string, unknown>;
  locationData: Record<string, unknown>;
  castingType: string;
}

interface ActionEmbedData {
  compendiumId?: string;
  packId?: string;
  stub?: Record<string, unknown>;
}

export class PF2eActorFactory {
  /**
   * Build a complete PF2e NPC actor data object from a parsed stat block.
   * Does NOT call game.actors.create() — that's the ActorBuilder's job.
   */
  static async build(
    npc: BundleNPC,
    portraitPath: string
  ): Promise<BuiltActorData> {
    const sb = npc.statBlock!;
    const unresolvedSpells: string[] = [];
    const spells: SpellEmbedData[] = [];
    const actions: ActionEmbedData[] = [];

    // Layer 1 — Skeleton
    const data = buildSkeleton(npc, sb, portraitPath);

    // Layer 2 — Combat stats (strikes as items handled as actions below)
    addCombatStats(data, sb);

    // Layer 3 — Abilities
    for (const action of sb.actions) {
      const resolved = await lookupAction(action.name);
      if (resolved) {
        actions.push({ compendiumId: resolved.id, packId: resolved.pack });
      } else {
        actions.push({ stub: buildActionStub(action) });
      }
    }

    // Layer 4 — Spellcasting
    for (const casting of sb.spellcasting) {
      for (const spell of casting.spells) {
        if (spell.compendiumSlug) {
          const resolved = await lookupSpell(spell.name);
          if (resolved) {
            spells.push({
              compendiumId: resolved.id,
              packId: resolved.pack,
              locationData: buildLocationData(casting.type, spell),
              castingType: casting.type,
            });
            continue;
          }
        }
        // Create stub
        unresolvedSpells.push(spell.name);
        spells.push({
          stub: buildSpellStub(spell.name, spell.level),
          locationData: buildLocationData(casting.type, spell),
          castingType: casting.type,
        });
      }
    }

    // Layer 5 — Metadata / flags
    addMetadata(data, npc);

    return { data, spells, actions, unresolvedSpells };
  }
}

// ── Layer builders ────────────────────────────────────────────────────────────

function buildSkeleton(
  npc: BundleNPC,
  sb: BundleStatBlock,
  img: string
): Record<string, unknown> {
  const tokenDim = SIZE_DIMENSIONS[sb.size] ?? 1;
  return {
    type: "npc",
    name: npc.name,
    img,
    system: {
      details: {
        level: { value: sb.level },
        blurb: npc.personality ?? "",
        publicNotes: npc.publicKnowledge ?? "",
        privateNotes: npc.secrets ?? "",
      },
      attributes: {
        hp: { value: sb.hp, max: sb.hp },
        ac: { value: sb.ac },
        immunities: sb.immunities.map(i => ({ type: i })),
        weaknesses: sb.weaknesses.map(w => ({ type: w.type, value: w.value })),
        resistances: sb.resistances.map(r => ({ type: r.type, value: r.value })),
      },
      saves: {
        fortitude: { value: sb.saves.fort },
        reflex:    { value: sb.saves.ref },
        will:      { value: sb.saves.will },
      },
      abilities: {
        str: { mod: sb.abilities.str },
        dex: { mod: sb.abilities.dex },
        con: { mod: sb.abilities.con },
        int: { mod: sb.abilities.int },
        wis: { mod: sb.abilities.wis },
        cha: { mod: sb.abilities.cha },
      },
      perception: { mod: sb.perception },
      traits: {
        value: sb.traits,
        rarity: sb.rarity,
        size: { value: sb.size },
        languages: { value: sb.languages },
        senses: { value: sb.senses.map(s => ({ type: s })) },
      },
      skills: Object.fromEntries(
        Object.entries(sb.skills).map(([k, v]) => [k, { base: v }])
      ),
      resources: {},
    },
    prototypeToken: {
      name: npc.name,
      texture: { src: img },
      width: tokenDim,
      height: tokenDim,
      actorLink: false,
      disposition: -1, // hostile
      vision: true,
    },
  };
}

function addCombatStats(data: Record<string, unknown>, sb: BundleStatBlock): void {
  const system = data.system as Record<string, unknown>;

  // Movement
  (system.attributes as Record<string, unknown>)["speed"] = {
    value: sb.speeds.land,
    otherSpeeds: [
      sb.speeds.fly    && { type: "fly",    value: sb.speeds.fly },
      sb.speeds.swim   && { type: "swim",   value: sb.speeds.swim },
      sb.speeds.climb  && { type: "climb",  value: sb.speeds.climb },
      sb.speeds.burrow && { type: "burrow", value: sb.speeds.burrow },
    ].filter(Boolean),
  };
}

function buildActionStub(action: {
  name: string;
  cost: unknown;
  traits: string[];
  description: string;
  trigger?: string;
  frequency?: { count: number; per: string };
}): Record<string, unknown> {
  const cost = action.cost;
  const actionType = cost === "passive" ? "passive"
    : cost === "reaction" ? "reaction"
    : cost === "free" ? "free"
    : "action";

  return {
    type: "action",
    name: action.name,
    system: {
      actionType: { value: actionType },
      actions: { value: typeof cost === "number" ? cost : null },
      traits: { value: action.traits },
      description: { value: action.description },
      ...(action.trigger ? { trigger: { value: action.trigger } } : {}),
      ...(action.frequency ? {
        frequency: { max: action.frequency.count, per: action.frequency.per },
      } : {}),
      flags: { "ai-adventure-importer": { generated: true } },
    },
  };
}

function buildSpellStub(name: string, level: number): Record<string, unknown> {
  return {
    type: "spell",
    name,
    system: {
      level: { value: level },
      description: {
        value: `<p><em>⚠ Unresolved spell — link manually from compendium browser.</em></p>`,
      },
      traits: { value: ["ai-generated"] },
      flags: { "ai-adventure-importer": { generated: true, stub: true } },
    },
  };
}

function buildLocationData(
  castingType: string,
  spell: { level: number; heightenedLevel?: number; frequency?: { type: string; count?: number } }
): Record<string, unknown> {
  // entryId is set by ActorBuilder after creating the SpellcastingEntry
  if (castingType === "innate") {
    const freq = spell.frequency;
    return {
      _placeholder_entryId: true,
      heightenedLevel: spell.heightenedLevel ?? spell.level,
      uses: freq?.type === "per-day"
        ? { value: freq.count ?? 1, max: freq.count ?? 1 }
        : null,
    };
  }
  return { _placeholder_entryId: true };
}

function addMetadata(data: Record<string, unknown>, npc: BundleNPC): void {
  const confidence = npc.statBlock?.confidenceScore ?? 1.0;
  data.flags = {
    "ai-adventure-importer": {
      generated: true,
      confidence,
      reviewRequired: confidence < CONFIDENCE.REVIEW,
      reviewSuggested: confidence >= CONFIDENCE.REVIEW && confidence < CONFIDENCE.HIGH,
      npcId: npc.id,
    },
  };
}
