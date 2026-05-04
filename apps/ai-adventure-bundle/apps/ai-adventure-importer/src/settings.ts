import { MODULE_ID, SETTINGS } from "./constants.js";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.FOLDER_NAME, {
    name: `${MODULE_ID}.settings.folderName.name`,
    hint: `${MODULE_ID}.settings.folderName.hint`,
    scope: "world", config: true, type: String,
    default: "AI Imported",
  });

  game.settings.register(MODULE_ID, SETTINGS.PLAYLIST_MODE, {
    name: `${MODULE_ID}.settings.playlistMode.name`,
    hint: `${MODULE_ID}.settings.playlistMode.hint`,
    scope: "world", config: true, type: String,
    default: "full",
    choices: {
      full:    `${MODULE_ID}.settings.playlistMode.full`,
      minimal: `${MODULE_ID}.settings.playlistMode.minimal`,
      none:    `${MODULE_ID}.settings.playlistMode.none`,
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.UPLOADS_PATH, {
    name: `${MODULE_ID}.settings.uploadsPath.name`,
    hint: `${MODULE_ID}.settings.uploadsPath.hint`,
    scope: "world", config: true, type: String,
    default: "ai-imports",
  });

  // Undo manifest — persisted across sessions, hidden from UI
  game.settings.register(MODULE_ID, "undo-manifest", {
    scope: "world", config: false, type: String, default: "",
  });
}
