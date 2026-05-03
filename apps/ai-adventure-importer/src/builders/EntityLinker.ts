import type { JournalMap, BuiltJournal } from "./JournalBuilder.js";
import type { BuiltActor } from "./ActorBuilder.js";
import type { BuiltScene } from "./SceneBuilder.js";
import type { BuildContext } from "./BuildContext.js";

type RefMap = Map<string, string>; // "type:id" → "@UUID[...]{name}"

export class EntityLinker {
  /**
   * Walk all journal pages and replace [[REF:type:id]] placeholders
   * with real Foundry @UUID[] links.
   *
   * Must run after all entities are created.
   */
  static async link(
    ctx: BuildContext,
    journals: JournalMap,
    actors: Map<string, BuiltActor>,
    scenes: Map<string, BuiltScene>
  ): Promise<void> {
    // Build the ref map: "actor:captain-marrow" → "@UUID[Actor.abc123]{Captain Marrow}"
    const refs = buildRefMap(journals, actors, scenes);
    if (refs.size === 0) return;

    // Apply to every journal page
    const allJournals = collectAllJournals(journals);
    for (const journal of allJournals) {
      for (const page of journal.pages) {
        const p = page as unknown as {
          id: string;
          type: string;
          text?: { content?: string };
          update(data: unknown): Promise<unknown>;
        };
        if (p.type !== "text" || !p.text?.content) continue;

        const updated = resolveRefs(p.text.content, refs);
        if (updated !== p.text.content) {
          await p.update({ "text.content": updated });
        }
      }
    }

    // Also pin map notes on scenes (journal page → canvas note)
    await pinSceneNotes(ctx, journals, scenes);
  }
}

// ── Ref map construction ──────────────────────────────────────────────────────

function buildRefMap(
  journals: JournalMap,
  actors: Map<string, BuiltActor>,
  scenes: Map<string, BuiltScene>
): RefMap {
  const refs: RefMap = new Map();

  // Rooms → locations journal pages
  for (const [, journal] of journals.locations) {
    for (const [roomId, pageId] of journal.pageIds) {
      const uuid = `@UUID[JournalEntry.${journal.entry.id}.JournalEntryPage.${pageId}]`;
      const page = findPage(journal, pageId);
      refs.set(`room:${roomId}`, `${uuid}{${page?.name ?? roomId}}`);
    }
  }

  // NPCs → npc journal pages
  for (const [, journal] of journals.npcs) {
    for (const [npcId, pageId] of journal.pageIds) {
      const uuid = `@UUID[JournalEntry.${journal.entry.id}.JournalEntryPage.${pageId}]`;
      const page = findPage(journal, pageId);
      refs.set(`npc-journal:${npcId}`, `${uuid}{${page?.name ?? npcId}}`);
    }
  }

  // Actors → actor UUID
  for (const [npcId, built] of actors) {
    refs.set(`actor:${npcId}`,
      `@UUID[Actor.${built.actor.id}]{${built.actor.name}}`);
  }

  // Scenes → scene UUID
  for (const [roomId, built] of scenes) {
    refs.set(`scene:${roomId}`,
      `@UUID[Scene.${built.scene.id}]{${built.scene.name}}`);
  }

  return refs;
}

// ── Ref resolution ────────────────────────────────────────────────────────────

const REF_PATTERN = /\[\[REF:([a-z-]+):([a-z0-9-]+)\]\]/g;

function resolveRefs(html: string, refs: RefMap): string {
  return html.replace(REF_PATTERN, (match, type, id) => {
    const key = `${type}:${id}`;
    return refs.get(key) ?? match; // leave unresolved refs as-is
  });
}

// ── Scene notes (map pins) ────────────────────────────────────────────────────

async function pinSceneNotes(
  ctx: BuildContext,
  journals: JournalMap,
  scenes: Map<string, BuiltScene>
): Promise<void> {
  for (const chapter of ctx.bundle.chapters) {
    const locationJournal = journals.locations.get(chapter.id);
    if (!locationJournal) continue;

    for (const room of chapter.rooms) {
      const built = scenes.get(room.id);
      if (!built) continue;
      const pageId = locationJournal.pageIds.get(room.id);
      if (!pageId) continue;

      // Pin a note at the centre of the scene (normalised 0.5, 0.5)
      // Positioned at scene centre — GMs can move them
      await built.scene.createEmbeddedDocuments("Note", [{
        entryId:   locationJournal.entry.id,
        pageId,
        x:         500, // centre of 1000×1000 normalised space
        y:         500,
        iconSize:  40,
        text:      `${room.code}. ${room.name}`,
        fontSize:  24,
        textAnchor: 1,
      }]);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function collectAllJournals(journals: JournalMap): JournalEntry[] {
  const all: JournalEntry[] = [journals.overview.entry];
  for (const [, j] of journals.locations)    all.push(j.entry);
  for (const [, j] of journals.detailedRooms) all.push(j.entry);
  for (const [, j] of journals.npcs)         all.push(j.entry);
  for (const [, j] of journals.handouts)     all.push(j.entry);
  return all;
}

function findPage(
  journal: BuiltJournal,
  pageId: string
): { name: string } | undefined {
  return [...journal.entry.pages].find(
    p => (p as unknown as { id: string }).id === pageId
  ) as unknown as { name: string } | undefined;
}
