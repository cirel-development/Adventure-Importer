import type { CompendiumIndex, PackIndex } from "@ai-adventure/bundle-schema";
import { MODULE_ID } from "../constants.js";

/** Document types we care about for slug resolution */
const RELEVANT_DOC_TYPES = new Set(["Actor", "Item"]);

/**
 * Iterates all installed Foundry compendium packs and saves a
 * compendium-index.json the GM can pass to the CLI via --compendium-index.
 */
export async function exportCompendiumIndex(): Promise<void> {
  ui.notifications.info(
    game.i18n.localize(`${MODULE_ID}.export.scanning`),
    { permanent: false }
  );

  const packs: PackIndex[] = [];
  let totalSlugs = 0;

  for (const [, pack] of game.packs.entries()) {
    if (!RELEVANT_DOC_TYPES.has(pack.documentName)) continue;

    // getIndex() is lazy — won't re-fetch if already loaded
    await pack.getIndex({ fields: ["name", "system.slug"] });

    const slugs: string[] = [];
    for (const entry of pack.index.values()) {
      const slug = entry.system?.slug ?? nameToSlug(entry.name);
      if (slug) slugs.push(slug);
    }

    packs.push({ id: pack.collection, slugs });
    totalSlugs += slugs.length;
  }

  const index: CompendiumIndex = {
    exportedAt: new Date().toISOString(),
    worldId: game.world.id,
    packs,
  };

  const json = JSON.stringify(index, null, 2);
  foundry.utils.saveDataToFile(json, "application/json", "compendium-index.json");

  ui.notifications.info(
    game.i18n.format(`${MODULE_ID}.export.done`, {
      packs: packs.length,
      slugs: totalSlugs,
    })
  );
}

/** Converts a display name to a best-guess slug for packs without system.slug */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
