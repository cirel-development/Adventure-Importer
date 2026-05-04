import type { BuildContext } from "./BuildContext.js";

export interface FolderMap {
  root:         Folder;
  adventure:    Folder;
  actors:       Folder;
  creatures:    Folder;
  actorsReview: Folder;
  items:        Folder;
  itemsReview:  Folder;
  playlists:    Folder;
  chapters:     Map<string, ChapterFolders>;
}

export interface ChapterFolders {
  root:     Folder;
  scenes:   Folder;
  journals: Folder;
  npcs:     Folder;
}

export class FolderBuilder {
  static async build(ctx: BuildContext): Promise<FolderMap> {
    const { bundle, undo, rootFolder } = ctx;
    const slug = bundle.adventure.slug;
    const adventureTitle = bundle.adventure.title;

    const root      = await ensureFolder(rootFolder, "Actor", null);
    const adventure = await ensureFolder(adventureTitle, "Actor", root);
    undo.track("folder", adventure.id, adventure.name, ["adventure", slug], root.id);

    const actors = await mkFolder("NPCs", "Actor", adventure);
    undo.track("folder", actors.id, actors.name, ["actors", slug], adventure.id);

    const creatures = await mkFolder("Creatures", "Actor", adventure);
    undo.track("folder", creatures.id, creatures.name, ["actors", slug], adventure.id);

    const actorsReview = await mkFolder("_Review Needed", "Actor", adventure);
    undo.track("folder", actorsReview.id, actorsReview.name, ["actors", slug], adventure.id);

    const items = await mkFolder("Items", "Item", adventure);
    undo.track("folder", items.id, items.name, ["items", slug], adventure.id);

    const itemsReview = await mkFolder("_Review Needed", "Item", items);
    undo.track("folder", itemsReview.id, itemsReview.name, ["items", slug], items.id);

    const playlists = await mkFolder(adventureTitle, "Playlist", null);
    undo.track("folder", playlists.id, playlists.name, ["playlists", slug], undefined);

    const chapters = new Map<string, ChapterFolders>();
    for (let i = 0; i < bundle.chapters.length; i++) {
      const chapter = bundle.chapters[i];
      const prefix  = String(i + 1).padStart(2, "0");
      const label   = `${prefix} — ${chapter.title}`;

      const journalAdventureFolder = await ensureFolder(adventureTitle, "JournalEntry", null);
      const chapterJournalFolder   = await mkFolder(label, "JournalEntry", journalAdventureFolder);
      undo.track("folder", chapterJournalFolder.id, chapterJournalFolder.name,
        ["journals", `chapter-${chapter.id}`, slug], journalAdventureFolder.id);

      const sceneAdventureFolder = await ensureFolder(adventureTitle, "Scene", null);
      const chapterSceneFolder   = await mkFolder(label, "Scene", sceneAdventureFolder);
      undo.track("folder", chapterSceneFolder.id, chapterSceneFolder.name,
        ["scenes", `chapter-${chapter.id}`, slug], sceneAdventureFolder.id);

      const chapterNPCFolder = await mkFolder(label, "Actor", actors);
      undo.track("folder", chapterNPCFolder.id, chapterNPCFolder.name,
        ["actors", `chapter-${chapter.id}`, slug], actors.id);

      chapters.set(chapter.id, {
        root:     chapterJournalFolder,
        scenes:   chapterSceneFolder,
        journals: chapterJournalFolder,
        npcs:     chapterNPCFolder,
      });
    }

    return { root, adventure, actors, creatures, actorsReview,
             items, itemsReview, playlists, chapters };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureFolder(
  name: string,
  type: string,
  parent: Folder | null
): Promise<Folder> {
  const existing = game.folders.contents.find(
    f => f.name === name && f.type === type && f.folder?.id === parent?.id
  );
  if (existing) return existing;
  return mkFolder(name, type, parent);
}

async function mkFolder(
  name: string,
  type: string,
  parent: Folder | null
): Promise<Folder> {
  // Use getDocumentClass() — the safest way to get the Folder class in v13
  const FolderClass = getDocumentClass("Folder");
  return FolderClass.create({
    name,
    type,
    folder: parent?.id ?? null,
    sorting: "a",
  }) as unknown as Folder;
}
