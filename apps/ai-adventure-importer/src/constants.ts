export const MODULE_ID = "ai-adventure-importer";
export const MODULE_TITLE = "AI Adventure Importer";

export const SETTINGS = {
  FOLDER_NAME:        "folderName",
  PLAYLIST_MODE:      "playlistMode",
  UPLOADS_PATH:       "uploadsPath",
} as const;

export const TEMPLATES = {
  IMPORTER_APP:  `modules/${MODULE_ID}/templates/importer-app.hbs`,
  REVIEW_STEP:   `modules/${MODULE_ID}/templates/review-step.hbs`,
  BUILD_STEP:    `modules/${MODULE_ID}/templates/build-step.hbs`,
} as const;

// Upload root — all assets land under this path in Foundry's user data
export const UPLOADS_ROOT = "ai-imports";

// Confidence thresholds (mirrors planning doc)
export const CONFIDENCE = {
  HIGH:   0.85, // no flag
  REVIEW: 0.60, // reviewSuggested flag
  // below 0.60 → reviewRequired flag + _Review Needed folder
} as const;
