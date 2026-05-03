import { MODULE_ID, MODULE_TITLE, TEMPLATES } from "./constants.js";
import { registerSettings } from "./settings.js";

// AppV2 factory import — must be deferred to call time, not parse time
let _ImporterApp: Awaited<ReturnType<typeof importApp>> | null = null;
async function importApp() {
  const { ImporterApp } = await import("./apps/ImporterApp.js");
  return ImporterApp;
}

// ── Init hook ────────────────────────────────────────────────────────────────

Hooks.once("init", async () => {
  console.log(`${MODULE_TITLE} | Initialising`);

  registerSettings();

  await foundry.applications.handlebars.loadTemplates([
    TEMPLATES.IMPORTER_APP,
    TEMPLATES.REVIEW_STEP,
    TEMPLATES.BUILD_STEP,
  ]);
});

// ── Ready hook ───────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  console.log(`${MODULE_TITLE} | Ready`);
});

// ── Scene controls ────────────────────────────────────────────────────────────
// v13: controls is a keyed object, not an array

Hooks.on("getSceneControlButtons", (controls: Record<string, unknown>) => {
  if (!game.user.isGM) return;

  const notes = controls["notes"] as {
    tools?: Record<string, unknown>;
  } | undefined;
  if (!notes?.tools) return;

  notes.tools["ai-adventure-importer"] = {
    name: "ai-adventure-importer",
    title: game.i18n.localize(`${MODULE_ID}.controls.openImporter`),
    icon: "fas fa-file-import",
    button: true,
    onChange: openImporter,
  };
});

// ── Open importer ─────────────────────────────────────────────────────────────

async function openImporter(): Promise<void> {
  const ImporterApp = _ImporterApp ?? (_ImporterApp = await importApp());
  const app = ImporterApp.create();
  app.render({ force: true });
}
