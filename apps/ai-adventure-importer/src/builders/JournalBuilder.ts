import type { BundleChapter, BundleRoom, BundleNPC, BundleHandout } from "@ai-adventure/bundle-schema";
import type { BuildContext } from "./BuildContext.js";
import type { FolderMap } from "./FolderBuilder.js";
import { resolveAsset } from "./BuildContext.js";

export interface BuiltJournal {
  entry:   JournalEntry;
  /** Map of room.id / npc.id → page id within this journal */
  pageIds: Map<string, string>;
}

export interface JournalMap {
  overview:    BuiltJournal;
  /** keyed by chapter.id */
  locations:   Map<string, BuiltJournal>;
  detailedRooms: Map<string, BuiltJournal>;
  npcs:        Map<string, BuiltJournal>;
  handouts:    Map<string, BuiltJournal>;
}

export class JournalBuilder {
  static async buildAll(ctx: BuildContext, folders: FolderMap): Promise<JournalMap> {
    const { bundle } = ctx;
    const adventureFolder = await ensureJournalFolder(bundle.adventure.title);

    // ── Overview ──────────────────────────────────────────────────────────
    const overview = await buildOverview(bundle.adventure, adventureFolder, ctx);
    ctx.undo.track("journal", overview.entry.id, overview.entry.name,
      ["journals", bundle.adventure.slug], adventureFolder?.id);

    const locations   = new Map<string, BuiltJournal>();
    const detailedRooms = new Map<string, BuiltJournal>();
    const npcs        = new Map<string, BuiltJournal>();
    const handouts    = new Map<string, BuiltJournal>();

    for (const chapter of bundle.chapters) {
      const chFolder = folders.chapters.get(chapter.id)?.journals ?? null;

      // ── Locations (scene entries) ─────────────────────────────────────
      const loc = await buildLocationsJournal(chapter, chFolder, ctx);
      locations.set(chapter.id, loc);
      ctx.undo.track("journal", loc.entry.id, loc.entry.name,
        ["journals", `chapter-${chapter.id}`, bundle.adventure.slug],
        chFolder?.id);

      // ── Detailed rooms ────────────────────────────────────────────────
      const det = await buildDetailedRoomsJournal(chapter, chFolder, ctx);
      detailedRooms.set(chapter.id, det);
      ctx.undo.track("journal", det.entry.id, det.entry.name,
        ["journals", `chapter-${chapter.id}`, bundle.adventure.slug],
        chFolder?.id);

      // ── NPC profiles ──────────────────────────────────────────────────
      const npcJournal = await buildNPCsJournal(chapter, chFolder, ctx);
      npcs.set(chapter.id, npcJournal);
      ctx.undo.track("journal", npcJournal.entry.id, npcJournal.entry.name,
        ["journals", `chapter-${chapter.id}`, bundle.adventure.slug],
        chFolder?.id);

      // ── Handouts ──────────────────────────────────────────────────────
      if (chapter.handouts.length > 0) {
        const handout = await buildHandoutsJournal(chapter, chFolder, ctx);
        handouts.set(chapter.id, handout);
        ctx.undo.track("journal", handout.entry.id, handout.entry.name,
          ["journals", `chapter-${chapter.id}`, bundle.adventure.slug],
          chFolder?.id);
      }
    }

    await ctx.undo.flush();
    return { overview, locations, detailedRooms, npcs, handouts };
  }
}

// ── Overview journal ──────────────────────────────────────────────────────────

async function buildOverview(
  adventure: { title: string; synopsis: string; tone?: string; slug: string },
  folder: Folder | null,
  ctx: BuildContext
): Promise<BuiltJournal> {
  const entry = await createJournal(`${adventure.title} — Overview`, folder);
  const pages: unknown[] = [
    textPage("Synopsis", `<p>${adventure.synopsis}</p>`, { ownership: { default: 0 } }),
    textPage("Running This Adventure",
      "<p><em>GM notes will be populated by the CLI processor.</em></p>",
      { ownership: { default: 0 } }),
  ];
  const created = await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  const pageIds = new Map<string, string>();
  (created as unknown as Array<{ id: string; name: string }>)
    .forEach(p => pageIds.set(p.name, p.id));
  return { entry, pageIds };
}

// ── Locations journal ─────────────────────────────────────────────────────────

async function buildLocationsJournal(
  chapter: BundleChapter,
  folder: Folder | null,
  ctx: BuildContext
): Promise<BuiltJournal> {
  const entry = await createJournal(`Locations — ${chapter.title}`, folder);
  const pages = chapter.rooms.map(room => buildRoomPage(room, ctx));
  const created = await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  const pageIds = new Map<string, string>();
  (created as unknown as Array<{ id: string; name: string; flags?: Record<string, unknown> }>)
    .forEach((p, i) => {
      const room = chapter.rooms[i];
      if (room) pageIds.set(room.id, p.id);
    });
  return { entry, pageIds };
}

function buildRoomPage(room: BundleRoom, ctx: BuildContext): unknown {
  const connections = room.connections.map(c =>
    `<li>${c.direction ? `<strong>${capitalize(c.direction)}</strong> — ` : ""}${c.description}` +
    ` → <em>[[REF:room:${c.toRoomId}]]</em>` +
    (c.requirement ? ` (${c.requirement})` : "") + `</li>`
  ).join("");

  const skillChecks = room.skillChecks.map(sc =>
    `<li><strong>${sc.skill} DC ${sc.dc}:</strong> ${sc.description}` +
    (sc.success ? ` <em>Success:</em> ${sc.success}` : "") +
    (sc.failure ? ` <em>Failure:</em> ${sc.failure}` : "") + `</li>`
  ).join("");

  const ambienceHtml = room.ambience
    ? `<details class="aai-ambience">
        <summary>🎵 Suggested Ambience</summary>
        <ul>${room.ambience.background.map(b => `<li>${b}</li>`).join("")}</ul>
        ${room.ambience.combatTrack ? `<p><strong>Combat:</strong> ${room.ambience.combatTrack}</p>` : ""}
      </details>`
    : "";

  const html = [
    room.readAloud
      ? `<blockquote class="aai-read-aloud">${room.readAloud}</blockquote>`
      : "",
    room.gmNotes ? `<div class="aai-gm-notes">${room.gmNotes}</div>` : "",
    connections ? `<h3>Connections</h3><ul>${connections}</ul>` : "",
    skillChecks ? `<h3>Skill Checks</h3><ul>${skillChecks}</ul>` : "",
    ambienceHtml,
  ].filter(Boolean).join("\n");

  return textPage(`${room.code}. ${room.name}`, html);
}

// ── Detailed rooms journal ────────────────────────────────────────────────────

async function buildDetailedRoomsJournal(
  chapter: BundleChapter,
  folder: Folder | null,
  ctx: BuildContext
): Promise<BuiltJournal> {
  const entry = await createJournal(`Detailed Rooms — ${chapter.title}`, folder);
  // Rooms with skill checks or GM notes get detailed pages
  const pages = chapter.rooms
    .filter(r => r.skillChecks.length > 0 || r.gmNotes)
    .map(r => buildDetailedRoomPage(r, chapter));
  if (pages.length === 0) {
    pages.push(textPage("(none)", "<p>No detailed room entries for this chapter.</p>"));
  }
  const created = await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  return { entry, pageIds: new Map() };
}

function buildDetailedRoomPage(room: BundleRoom, chapter: BundleChapter): unknown {
  const encountersInRoom = chapter.encounters
    .filter(e => e.roomId === room.id)
    .map(e => `<li>${e.name ?? "Encounter"} — ${e.difficulty ?? "unknown difficulty"}</li>`)
    .join("");

  const itemsInRoom = chapter.items
    .filter(i => i.locationId === room.id)
    .map(i => `<li>${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}</li>`)
    .join("");

  const hazardsInRoom = chapter.hazards
    .filter(h => h.roomId === room.id)
    .map(h => `<li><strong>${h.name}</strong> — ${h.gmNotes}</li>`)
    .join("");

  const html = [
    encountersInRoom ? `<h3>Encounters</h3><ul>${encountersInRoom}</ul>` : "",
    hazardsInRoom    ? `<h3>Hazards</h3><ul>${hazardsInRoom}</ul>` : "",
    itemsInRoom      ? `<h3>Treasure</h3><ul>${itemsInRoom}</ul>` : "",
    room.gmNotes     ? `<h3>GM Notes</h3>${room.gmNotes}` : "",
  ].filter(Boolean).join("\n");

  return {
    ...(textPage(`${room.code}. ${room.name} — Details`, html) as object),
    ownership: { default: 0 },   // GM only
  };
}

// ── NPC journal ───────────────────────────────────────────────────────────────

async function buildNPCsJournal(
  chapter: BundleChapter,
  folder: Folder | null,
  ctx: BuildContext
): Promise<BuiltJournal> {
  const entry = await createJournal(`NPCs — ${chapter.title}`, folder);
  const pages = chapter.npcs.map(npc => buildNPCPage(npc, ctx));
  if (pages.length === 0) {
    pages.push(textPage("(none)", "<p>No named NPCs in this chapter.</p>"));
  }
  const created = await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  const pageIds = new Map<string, string>();
  (created as unknown as Array<{ id: string }>)
    .forEach((p, i) => {
      const npc = chapter.npcs[i];
      if (npc) pageIds.set(npc.id, p.id);
    });
  return { entry, pageIds };
}

function buildNPCPage(npc: BundleNPC, ctx: BuildContext): unknown {
  const portrait = resolveAsset(ctx, npc.portraitAssetId);
  const portraitHtml = portrait !== ctx.missingImg
    ? `<figure><img src="${portrait}" style="max-width:200px"/></figure>`
    : "";

  const voiceHtml = npc.voiceNotes
    ? `<details class="aai-voice">
        <summary>🎭 Voice Notes</summary>
        <p>${npc.voiceNotes}</p>
      </details>`
    : "";

  const html = [
    portraitHtml,
    npc.publicKnowledge
      ? `<h3>Public Knowledge</h3>${npc.publicKnowledge}`
      : "",
    npc.personality
      ? `<h3>Personality</h3><p>${npc.personality}</p>`
      : "",
    voiceHtml,
    npc.secrets
      ? `<h3>Secrets &amp; Motivations</h3>${npc.secrets}`
      : "",
    npc.tactics
      ? `<h3>Tactics</h3>${npc.tactics}`
      : "",
    `<p><em>Actor: [[REF:actor:${npc.id}]]</em></p>`,
  ].filter(Boolean).join("\n");

  return textPage(npc.name, html);
}

// ── Handouts journal ──────────────────────────────────────────────────────────

async function buildHandoutsJournal(
  chapter: BundleChapter,
  folder: Folder | null,
  ctx: BuildContext
): Promise<BuiltJournal> {
  const entry = await createJournal(`Handouts — ${chapter.title}`, folder);
  const pages = chapter.handouts.map(h => buildHandoutPage(h, ctx));
  await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  return { entry, pageIds: new Map() };
}

function buildHandoutPage(handout: BundleHandout, ctx: BuildContext): unknown {
  if (handout.type === "image" && handout.assetId) {
    const src = resolveAsset(ctx, handout.assetId);
    return {
      type: "image",
      name: handout.name,
      src,
      ownership: { default: 0 }, // revealed by GM
      flags: {
        "ai-adventure-importer": {
          foundLocation: handout.foundLocation,
        },
      },
    };
  }

  const html = [
    handout.content ?? "<p><em>No content provided.</em></p>",
    handout.assetId
      ? `<figure><img src="${resolveAsset(ctx, handout.assetId)}"/></figure>`
      : "",
    handout.foundLocation
      ? `<p><em>Found: ${handout.foundLocation}</em></p>`
      : "",
  ].filter(Boolean).join("\n");

  return {
    ...(textPage(handout.name, html) as object),
    ownership: { default: 0 },
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

async function ensureJournalFolder(name: string): Promise<Folder | null> {
  const existing = game.folders.contents.find(
    f => f.name === name && f.type === "JournalEntry" && !f.folder
  );
  if (existing) return existing;
  return (getDocumentClass("Folder") as any).create({
    name, type: "JournalEntry", folder: null,
  }) as unknown as Folder;
}

async function createJournal(name: string, folder: Folder | null): Promise<JournalEntry> {
  return (getDocumentClass("JournalEntry") as any).create({
    name,
    folder: folder?.id ?? null,
    ownership: { default: 0 },
  }) as unknown as JournalEntry;
}

function textPage(name: string, content: string, extra: Record<string, unknown> = {}): unknown {
  return {
    type: "text",
    name,
    text: { content, format: 1 },
    title: { show: true },
    ...extra,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
