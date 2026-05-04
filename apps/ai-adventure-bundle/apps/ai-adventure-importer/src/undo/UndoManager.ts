import { MODULE_ID } from "../constants.js";

export type EntityType = "folder" | "scene" | "actor" | "item" | "journal" | "playlist";

export interface UndoEntry {
  type:            EntityType;
  id:              string;
  name:            string;
  tags:            string[];
  parentFolderId?: string;
  status:          "pending" | "deleted" | "not-found" | "error";
  deletedAt?:      number;
  error?:          string;
}

export interface UndoManifest {
  importId:      string;
  worldId:       string;
  adventureName: string;
  adventureSlug: string;
  createdAt:     number;
  completedAt?:  number;
  entries:       UndoEntry[];
}

export interface UndoResult {
  deleted:  number;
  notFound: number;
  errors:   UndoEntry[];
}

const DELETION_ORDER: EntityType[] = [
  "playlist", "item", "actor", "journal", "scene", "folder",
];

const COLLECTION_MAP: Record<EntityType, keyof typeof game> = {
  playlist: "playlists",
  item:     "items",
  actor:    "actors",
  journal:  "journal",
  scene:    "scenes",
  folder:   "folders",
};

// Setting key — registered in settings.ts
const MANIFEST_SETTING = "undo-manifest";

export class UndoManager {
  private manifest:   UndoManifest;
  private dirty = false;
  private flushCount = 0;
  private readonly FLUSH_EVERY = 10;

  private constructor(manifest: UndoManifest) {
    this.manifest = manifest;
  }

  static createNew(
    importId: string,
    adventureName: string,
    adventureSlug: string,
    worldId: string
  ): UndoManager {
    return new UndoManager({
      importId, worldId, adventureName, adventureSlug,
      createdAt: Date.now(),
      entries: [],
    });
  }

  // ── Tracking ──────────────────────────────────────────────────────────────

  track(
    type: EntityType,
    id: string,
    name: string,
    tags: string[],
    parentFolderId?: string
  ): void {
    this.manifest.entries.push({
      type, id, name, tags, parentFolderId, status: "pending",
    });
    this.dirty = true;
    if (++this.flushCount >= this.FLUSH_EVERY) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.flushCount = 0;
    this.dirty = false;
    await this._save();
  }

  async markComplete(): Promise<void> {
    this.manifest.completedAt = Date.now();
    this.dirty = true;
    await this.flush();
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  preview(): { byType: Record<EntityType, number>; total: number } {
    const byType = {} as Record<EntityType, number>;
    for (const t of DELETION_ORDER) byType[t] = 0;
    for (const e of this.manifest.entries) {
      if (e.status === "pending") byType[e.type]++;
    }
    return {
      byType,
      total: this.manifest.entries.filter(e => e.status === "pending").length,
    };
  }

  async undoAll(
    onProgress?: (done: number, total: number, entry: UndoEntry) => void
  ): Promise<UndoResult> {
    const result: UndoResult = { deleted: 0, notFound: 0, errors: [] };
    const pending = this.manifest.entries.filter(e => e.status === "pending");
    let done = 0;

    const byType = new Map<EntityType, UndoEntry[]>();
    for (const t of DELETION_ORDER) byType.set(t, []);
    for (const e of pending) byType.get(e.type)!.push(e);

    for (const type of DELETION_ORDER) {
      const entries = byType.get(type)!;
      if (entries.length === 0) continue;

      if (type === "folder") {
        for (const entry of [...entries].reverse()) {
          onProgress?.(++done, pending.length, entry);
          await this._deleteOne(entry, result);
        }
      } else {
        const ids = entries.map(e => e.id);
        const collection = game[COLLECTION_MAP[type]] as Collection<FoundryDocument>;
        try {
          await (collection as any).deleteDocuments?.(ids);
          for (const e of entries) {
            e.status = "deleted";
            e.deletedAt = Date.now();
            result.deleted++;
            onProgress?.(++done, pending.length, e);
          }
        } catch {
          for (const entry of entries) {
            onProgress?.(++done, pending.length, entry);
            await this._deleteOne(entry, result);
          }
        }
      }
    }

    await this._save();
    return result;
  }

  async undoByTags(_tags: string[]): Promise<UndoResult> {
    throw new Error("Partial undo not yet implemented.");
  }

  get entryCount(): number { return this.manifest.entries.length; }
  get adventureName(): string { return this.manifest.adventureName; }

  // ── Private — use game.settings, no FilePicker needed ────────────────────

  private async _save(): Promise<void> {
    try {
      await game.settings.set(MODULE_ID, MANIFEST_SETTING, JSON.stringify(this.manifest));
    } catch (err) {
      // Non-fatal — undo still works in-memory this session
      console.warn("[ai-adventure-importer] Undo manifest not persisted:", (err as Error).message);
    }
  }

  private async _deleteOne(entry: UndoEntry, result: UndoResult): Promise<void> {
    const collection = game[COLLECTION_MAP[entry.type]] as Collection<FoundryDocument>;
    const doc = collection.get(entry.id);
    if (!doc) { entry.status = "not-found"; result.notFound++; return; }
    try {
      await doc.delete();
      entry.status = "deleted";
      entry.deletedAt = Date.now();
      result.deleted++;
    } catch (err) {
      entry.status = "error";
      entry.error = (err as Error).message;
      result.errors.push(entry);
    }
  }
}

interface Collection<T> { get(id: string): T | undefined; }
interface FoundryDocument { id: string; delete(): Promise<unknown>; }
