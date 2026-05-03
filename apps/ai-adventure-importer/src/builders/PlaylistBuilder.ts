import type { BuildContext } from "./BuildContext.js";
import type { FolderMap } from "./FolderBuilder.js";
import { MODULE_ID, SETTINGS } from "../constants.js";

export class PlaylistBuilder {
  static async buildAll(ctx: BuildContext, folders: FolderMap): Promise<void> {
    const mode = game.settings.get<string>(MODULE_ID, SETTINGS.PLAYLIST_MODE);
    if (mode === "none") return;

    for (let i = 0; i < ctx.bundle.chapters.length; i++) {
      const chapter = ctx.bundle.chapters[i];
      const prefix = String(i + 1).padStart(2, "0");
      const label = `${prefix} — ${chapter.title}`;
      const folder = folders.playlists;

      if (mode === "full") {
        const ambience = await createPlaylist(`${label} — Ambience`, folder, "sequential");
        ctx.undo.track("playlist", ambience.id, ambience.name,
          ["playlists", ctx.bundle.adventure.slug], folder.id);

        const combat = await createPlaylist(`${label} — Combat`, folder, "shuffle");
        ctx.undo.track("playlist", combat.id, combat.name,
          ["playlists", ctx.bundle.adventure.slug], folder.id);
      } else {
        // minimal
        const pl = await createPlaylist(`${label} — Sounds`, folder, "sequential");
        ctx.undo.track("playlist", pl.id, pl.name,
          ["playlists", ctx.bundle.adventure.slug], folder.id);
      }
    }

    await ctx.undo.flush();
  }
}

async function createPlaylist(
  name: string,
  folder: Folder,
  mode: "sequential" | "shuffle"
): Promise<Playlist> {
  return (getDocumentClass("Playlist") as any).create({
    name,
    folder: folder.id,
    mode: mode === "shuffle" ? 2 : 0, // 0=sequential, 2=shuffle in Foundry v13
    sounds: [],
  }) as unknown as Playlist;
}
