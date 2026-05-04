import type { BundleItem } from "@ai-adventure/bundle-schema";
import type { BuildContext } from "./BuildContext.js";
import type { FolderMap } from "./FolderBuilder.js";
import { lookupEquipment } from "../pf2e/PF2eCompendiumLookup.js";

export class ItemBuilder {
  static async buildAll(ctx: BuildContext, folders: FolderMap): Promise<void> {
    for (const chapter of ctx.bundle.chapters) {
      // Group items by treasure location (room) to create loot actors
      const byRoom = new Map<string, BundleItem[]>();
      const npcInventory: BundleItem[] = [];
      const questObjects: BundleItem[] = [];

      for (const item of chapter.items) {
        if (item.location === "npc-inventory") {
          npcInventory.push(item);
        } else if (item.location === "quest-object") {
          questObjects.push(item);
        } else {
          const arr = byRoom.get(item.locationId) ?? [];
          arr.push(item);
          byRoom.set(item.locationId, arr);
        }
      }

      // ── Loot actors (treasure in rooms) ─────────────────────────────────
      for (const [roomId, items] of byRoom) {
        try {
          await buildLootActor(roomId, items, ctx, folders);
        } catch (err) {
          console.error(`[ai-adventure-importer] Loot actor for room "${roomId}" failed:`, err);
        }
      }

      // ── NPC inventory ────────────────────────────────────────────────────
      // Handled in ActorBuilder — skip here to avoid double-creation

      // ── Quest objects ────────────────────────────────────────────────────
      for (const item of questObjects) {
        try {
          await buildQuestItem(item, ctx, folders);
        } catch (err) {
          console.error(`[ai-adventure-importer] Quest item "${item.name}" failed:`, err);
        }
      }
    }

    await ctx.undo.flush();
  }
}

// ── Loot actors ───────────────────────────────────────────────────────────────

async function buildLootActor(
  roomId: string,
  items: BundleItem[],
  ctx: BuildContext,
  folders: FolderMap
): Promise<void> {
  const room = ctx.bundle.chapters
    .flatMap(c => c.rooms)
    .find(r => r.id === roomId);
  const name = room ? `${room.code}. ${room.name} — Treasure` : `Room ${roomId} — Treasure`;

  // Build item data for the loot actor
  const itemDocs: unknown[] = [];
  for (const item of items) {
    const doc = await resolveItemDoc(item, ctx);
    if (doc) itemDocs.push(doc);
  }

  const lootData = {
    type: "loot",
    name,
    folder: folders.actors.id,
    flags: { "ai-adventure-importer": { loot: true, roomId } },
  };

  const actor = await (getDocumentClass("Actor") as any).create(lootData) as unknown as Actor;
  ctx.undo.track("actor", actor.id, actor.name,
    ["actors", "loot", ctx.bundle.adventure.slug], folders.actors.id);

  if (itemDocs.length > 0) {
    await actor.createEmbeddedDocuments("Item", itemDocs);
  }
}

// ── Quest items ───────────────────────────────────────────────────────────────

async function buildQuestItem(
  item: BundleItem,
  ctx: BuildContext,
  folders: FolderMap
): Promise<void> {
  const confidence = item.custom?.confidenceScore ?? 1.0;
  const folder = confidence < 0.6 ? folders.itemsReview : folders.items;

  const doc = await resolveItemDoc(item, ctx);
  if (!doc) return;

  const created = await (getDocumentClass("Item") as any).create({
    ...(doc as object),
    folder: folder.id,
  }) as unknown as Item;

  ctx.undo.track("item", created.id, created.name,
    ["items", ctx.bundle.adventure.slug], folder.id);
}

// ── Item resolution ───────────────────────────────────────────────────────────

async function resolveItemDoc(
  item: BundleItem,
  ctx: BuildContext
): Promise<unknown | null> {
  // 1. Direct compendium link
  if (item.compendiumSlug) {
    const match = await lookupEquipment(item.compendiumSlug);
    if (match) {
      const pack = game.packs.get(match.pack);
      const doc = await pack?.getDocument(match.id);
      if (doc) {
        const data = (doc as unknown as { toObject(): Record<string, unknown> }).toObject();
        if (item.quantity > 1) {
          (data.system as Record<string, unknown>).quantity = item.quantity;
        }
        return data;
      }
    }
  }

  // 2. Base item + runes
  if (item.baseSlug && item.runes?.length) {
    const base = await lookupEquipment(item.baseSlug);
    if (base) {
      const pack = game.packs.get(base.pack);
      const doc = await pack?.getDocument(base.id);
      if (doc) {
        const data = (doc as unknown as { toObject(): Record<string, unknown> }).toObject();
        // Rune application is system-specific — flag for GM to apply manually
        (data.flags as Record<string, unknown>)["ai-adventure-importer"] = {
          pendingRunes: item.runes,
          note: `Apply runes manually: ${item.runes.join(", ")}`,
        };
        return data;
      }
    }
  }

  // 3. Custom item
  if (item.custom) {
    return {
      type: item.custom.type,
      name: item.name,
      img: "icons/svg/item-bag.svg",
      system: {
        level: { value: item.custom.level },
        rarity: item.custom.rarity,
        traits: { value: item.custom.traits },
        bulk: { value: item.custom.bulk },
        price: item.custom.price
          ? { value: { gp: item.custom.price.gp ?? 0, sp: item.custom.price.sp ?? 0 } }
          : undefined,
        description: { value: item.custom.description },
      },
      flags: {
        "ai-adventure-importer": {
          generated: true,
          confidence: item.custom.confidenceScore,
        },
      },
    };
  }

  console.warn(`[ai-adventure-importer] Could not resolve item "${item.name}" — skipping`);
  return null;
}
