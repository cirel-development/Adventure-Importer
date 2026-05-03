import type { BundleNPC } from "@ai-adventure/bundle-schema";
import type { BuildContext } from "./BuildContext.js";
import type { FolderMap } from "./FolderBuilder.js";
import { resolveAsset } from "./BuildContext.js";
import { lookupActor } from "../pf2e/PF2eCompendiumLookup.js";
import { PF2eActorFactory } from "../pf2e/PF2eActorFactory.js";
import { CONFIDENCE } from "../constants.js";

export interface BuiltActor {
  npcId:  string;
  actor:  Actor;
  /** True when sourced from compendium */
  fromCompendium: boolean;
}

export class ActorBuilder {
  /**
   * Build all actors across all chapters.
   * Returns a map of npcId → BuiltActor for use by SceneBuilder (token placement)
   * and EntityLinker (portrait @UUID links).
   */
  static async buildAll(
    ctx: BuildContext,
    folders: FolderMap
  ): Promise<Map<string, BuiltActor>> {
    const results = new Map<string, BuiltActor>();

    for (const chapter of ctx.bundle.chapters) {
      const chapterFolders = folders.chapters.get(chapter.id);

      for (const npc of chapter.npcs) {
        try {
          const built = await ActorBuilder._buildOne(npc, ctx, folders, chapterFolders?.npcs ?? folders.actors);
          results.set(npc.id, built);
          ctx.undo.track(
            "actor", built.actor.id, built.actor.name,
            ["actors", `chapter-${chapter.id}`, ctx.bundle.adventure.slug],
            built.actor.folder?.id
          );
        } catch (err) {
          console.error(`[ai-adventure-importer] Failed to build actor "${npc.name}":`, err);
        }
      }
    }

    await ctx.undo.flush();
    return results;
  }

  private static async _buildOne(
    npc: BundleNPC,
    ctx: BuildContext,
    folders: FolderMap,
    defaultFolder: Folder
  ): Promise<BuiltActor> {
    const portrait = resolveAsset(ctx, npc.portraitAssetId);

    // ── Compendium path ────────────────────────────────────────────────────
    if (npc.compendiumSlug || npc.compendiumName) {
      const searchName = npc.compendiumName ?? npc.compendiumSlug!;
      const match = npc.compendiumSlug
        ? await lookupActor(npc.compendiumSlug)
        : await lookupActor(searchName);

      if (match) {
        const pack = game.packs.get(match.pack);
        const doc = await pack?.getDocument(match.id);
        if (doc) {
          // Import from compendium into the world
          const actorData = (doc as unknown as { toObject(): unknown }).toObject() as Record<string, unknown>;
          actorData.folder = defaultFolder.id;
          if (portrait !== ctx.missingImg) {
            actorData.img = portrait;
            (actorData.prototypeToken as Record<string, unknown>).texture =
              { src: portrait };
          }
          const actor = await (getDocumentClass("Actor") as any).create(actorData) as unknown as Actor;
          return { npcId: npc.id, actor, fromCompendium: true };
        }
      }
    }

    // ── Custom stat block path ─────────────────────────────────────────────
    if (!npc.statBlock) {
      // No compendium match and no stat block — create a minimal placeholder
      const actor = await (getDocumentClass("Actor") as any).create({
        type: "npc",
        name: npc.name,
        img: portrait,
        folder: defaultFolder.id,
        flags: {
          "ai-adventure-importer": {
            generated: true, placeholder: true, npcId: npc.id,
          },
        },
      }) as unknown as Actor;
      return { npcId: npc.id, actor, fromCompendium: false };
    }

    // Route to correct folder based on confidence
    const confidence = npc.statBlock.confidenceScore;
    const folder = confidence < CONFIDENCE.REVIEW
      ? folders.actorsReview
      : npc.isUnique
        ? defaultFolder
        : folders.creatures;

    const { data, spells, actions, unresolvedSpells } =
      await PF2eActorFactory.build(npc, portrait);

    const actorData = { ...(data as object), folder: folder.id };
    const actor = await (getDocumentClass("Actor") as any).create(actorData) as unknown as Actor;

    // Create embedded spellcasting entries + spells
    // Wrapped in try/catch — PF2e's NPCPF2e.createEmbeddedDocuments override
    // can reject spellcastingEntry items depending on the system version.
    // If it fails, we note all spells in GM notes for manual entry.
    const allSpellNames = npc.statBlock.spellcasting
      .flatMap(c => c.spells.map(s => `${s.name} (lvl ${s.level})`));

    try {
      for (const casting of npc.statBlock.spellcasting) {
        const entryData = buildSpellcastingEntry(casting);
        const [entry] = await actor.createEmbeddedDocuments("Item", [entryData]);
        const entryId = (entry as unknown as { id: string }).id;

        // Gather spells for this casting block
        const castingSpells = spells.filter(s => s.castingType === casting.type);
        const spellDocs: unknown[] = [];

        for (const spell of castingSpells) {
          if (spell.compendiumId && spell.packId) {
            const pack = game.packs.get(spell.packId);
            const doc = await pack?.getDocument(spell.compendiumId);
            if (doc) {
              const sd = (doc as unknown as { toObject(): Record<string, unknown> }).toObject();
              sd.system = { ...(sd.system as object), location: { value: entryId } };
              spellDocs.push(sd);
              continue;
            }
          }
          // Stub
          if (spell.stub) {
            const sd = { ...spell.stub, system: {
              ...(spell.stub.system as object),
              location: { value: entryId },
            }};
            spellDocs.push(sd);
          }
        }

        if (spellDocs.length > 0) {
          await actor.createEmbeddedDocuments("Item", spellDocs);
        }
      }
    } catch (err) {
      // Spellcasting entry creation failed (PF2e version compatibility issue)
      // Surface all spells in GM notes so they can be added manually
      console.warn(`[ai-adventure-importer] Spellcasting entry failed for "${npc.name}", adding to notes:`, err);
      unresolvedSpells.push(...allSpellNames);
    }

    // Create embedded action items
    const actionDocs: unknown[] = [];
    for (const action of actions) {
      if (action.compendiumId && action.packId) {
        const pack = game.packs.get(action.packId);
        const doc = await pack?.getDocument(action.compendiumId);
        if (doc) {
          actionDocs.push((doc as unknown as { toObject(): unknown }).toObject());
          continue;
        }
      }
      if (action.stub) actionDocs.push(action.stub);
    }
    if (actionDocs.length > 0) {
      await actor.createEmbeddedDocuments("Item", actionDocs);
    }

    // Surface unresolved spells in actor notes
    if (unresolvedSpells.length > 0) {
      const note = `<p><strong>⚠ Unresolved spells (link manually):</strong> ${unresolvedSpells.join(", ")}</p>`;
      await actor.update({
        "system.details.privateNotes":
          (npc.statBlock ? `${note}<br>` : "") +
          ((actor.system as Record<string, { privateNotes?: string }>)
            .details?.privateNotes ?? ""),
      });
    }

    return { npcId: npc.id, actor, fromCompendium: false };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSpellcastingEntry(casting: {
  type: string;
  tradition: string;
  dc: number;
  attack?: number;
}): Record<string, unknown> {
  return {
    type: "spellcastingEntry",
    name: `${capitalize(casting.tradition)} ${capitalize(casting.type)} Spells`,
    system: {
      prepared: { value: casting.type },
      tradition: { value: casting.tradition },
      spelldc: { dc: casting.dc, value: casting.attack ?? casting.dc - 10 },
    },
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
