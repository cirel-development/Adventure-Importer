// Foundry VTT v13 type shims

// ── Application base classes ──────────────────────────────────────────────────

declare namespace foundry {
  namespace applications {
    namespace api {
      class ApplicationV2 {
        constructor(options?: ApplicationOptions);
        static PARTS?: Record<string, { template: string }>;
        static DEFAULT_OPTIONS: ApplicationOptions;
        options: ApplicationOptions;
        element: HTMLElement;
        render(options?: { force?: boolean }): Promise<void>;
        close(): Promise<void>;
        _prepareContext(options: unknown): Promise<Record<string, unknown>>;
        _onRender(context: unknown, options: unknown): void;
        bringToFront(): void;
      }
      // Mixin: returns a constructor whose instances have all ApplicationV2 methods
      function HandlebarsApplicationMixin<
        T extends abstract new (...args: any[]) => ApplicationV2
      >(Base: T): T;
    }
    namespace handlebars {
      function loadTemplates(paths: string[]): Promise<void>;
    }
  }
  namespace utils {
    function debounce<T extends (...a: unknown[]) => unknown>(fn: T, delay: number): T;
  }
}

interface ApplicationOptions {
  id?: string;
  classes?: string[];
  tag?: string;
  window?: { title?: string; icon?: string; resizable?: boolean };
  position?: { width?: number | string; height?: number | string };
  PARTS?: Record<string, { template: string }>;
}

// ── Game globals ──────────────────────────────────────────────────────────────

declare const game: {
  user: { isGM: boolean; id: string };
  world: { id: string };
  settings: {
    register(moduleId: string, key: string, options: SettingConfig): void;
    registerMenu(moduleId: string, key: string, options: SettingMenuConfig): void;
    get<T = unknown>(moduleId: string, key: string): T;
    set<T = unknown>(moduleId: string, key: string, value: T): Promise<void>;
  };
  actors: Collection<Actor>;
  scenes: Collection<Scene>;
  journal: Collection<JournalEntry>;
  items: Collection<Item>;
  folders: Collection<Folder>;
  playlists: Collection<Playlist>;
  // Map<id, pack> — iterate as entries() for [id, pack] tuples
  packs: {
    get(key: string): CompendiumCollection | undefined;
    entries(): IterableIterator<[string, CompendiumCollection]>;
    [Symbol.iterator](): IterableIterator<CompendiumCollection>;
  };
  i18n: {
    localize(key: string): string;
    format(key: string, data?: Record<string, unknown>): string;
  };
  modules: Map<string, { active: boolean }>;
};

declare const ui: {
  notifications: {
    info(msg: string, options?: { permanent?: boolean }): void;
    warn(msg: string, options?: { permanent?: boolean }): void;
    error(msg: string, options?: { permanent?: boolean }): void;
  };
  sidebar: { tabs: Record<string, { render(): void }> };
};

declare const canvas: {
  dimensions: {
    sceneX: number; sceneY: number;
    sceneWidth: number; sceneHeight: number;
    size: number;
  };
  scene: Scene | null;
};

// ── Document types ────────────────────────────────────────────────────────────

interface Collection<T> {
  get(id: string): T | undefined;
  getName(name: string): T | undefined;
  create(data: unknown, options?: unknown): Promise<T>;
  createDocuments?(data: unknown[], options?: unknown): Promise<T[]>;
  deleteDocuments?(ids: string[], options?: unknown): Promise<T[]>;
  contents: T[];
  [Symbol.iterator](): Iterator<T>;
}

interface FoundryDocument {
  id: string;
  name: string;
  delete(): Promise<this>;
  update(data: unknown): Promise<this>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<this>;
  toObject(): unknown;
}

interface Folder extends FoundryDocument { type: string; folder: Folder | null }
interface Actor extends FoundryDocument {
  type: string; folder: Folder | null; img: string; system: unknown;
  items: Collection<Item>;
  createEmbeddedDocuments(type: string, data: unknown[]): Promise<FoundryDocument[]>;
  prototypeToken: unknown;
}
interface Item extends FoundryDocument { type: string; img: string; system: unknown }
interface Scene extends FoundryDocument {
  walls: Collection<FoundryDocument>; lights: Collection<FoundryDocument>;
  sounds: Collection<FoundryDocument>; tokens: Collection<FoundryDocument>;
  notes: Collection<FoundryDocument>;
  createEmbeddedDocuments(type: string, data: unknown[]): Promise<FoundryDocument[]>;
  activate(): Promise<this>;
  background: { src: string }; grid: { size: number; type: number };
}
interface JournalEntry extends FoundryDocument {
  pages: Collection<FoundryDocument>; folder: Folder | null;
  createEmbeddedDocuments(type: string, data: unknown[]): Promise<FoundryDocument[]>;
}
interface Playlist extends FoundryDocument {
  sounds: Collection<FoundryDocument>; folder: Folder | null;
}
interface CompendiumCollection {
  collection: string;
  documentName: string;
  index: Map<string, { _id: string; name: string; system?: { slug?: string } }>;
  getIndex(options?: unknown): Promise<CompendiumCollection["index"]>;
  getDocument(id: string): Promise<FoundryDocument | null>;
}

// ── Settings types ────────────────────────────────────────────────────────────

interface SettingConfig {
  name?: string; hint?: string;
  scope: "world" | "client"; config: boolean;
  type: unknown; default: unknown;
  choices?: Record<string, string>;
  onChange?: (value: unknown) => void;
}
interface SettingMenuConfig {
  name: string; label: string; icon?: string;
  type: new () => unknown; restricted?: boolean;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

declare const Hooks: {
  on(event: string, callback: (...args: any[]) => void): number;
  once(event: string, callback: (...args: any[]) => void): number;
  call(event: string, ...args: unknown[]): boolean;
  callAll(event: string, ...args: unknown[]): boolean;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

declare function saveDataToFile(data: string, type: string, filename: string): void;
declare function readTextFromFile(file: File): Promise<string>;

declare class FilePicker {
  static upload(source: string, path: string, file: File, options?: unknown): Promise<{ path: string }>;
  static createDirectory(source: string, path: string, options?: unknown): Promise<void>;
  static browse(source: string, path: string, options?: unknown): Promise<{ files: string[]; dirs: string[] }>;
}

// ── Document class static create() methods (v13 API) ─────────────────────────
// In Foundry v13, use ClassName.create(data) not game.collection.create(data)

declare class Folder {
  static create(data: unknown, options?: unknown): Promise<Folder>;
  id: string;
  name: string;
  type: string;
  folder: Folder | null;
  delete(): Promise<Folder>;
  update(data: unknown): Promise<Folder>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<Folder>;
}

declare class Actor {
  static create(data: unknown, options?: unknown): Promise<Actor>;
  id: string;
  name: string;
  type: string;
  img: string;
  folder: Folder | null;
  system: unknown;
  items: Collection<Item>;
  prototypeToken: unknown;
  createEmbeddedDocuments(type: string, data: unknown[]): Promise<FoundryDocument[]>;
  delete(): Promise<Actor>;
  update(data: unknown): Promise<Actor>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<Actor>;
  toObject(): unknown;
}

declare class Scene {
  static create(data: unknown, options?: unknown): Promise<Scene>;
  id: string;
  name: string;
  folder: Folder | null;
  background: { src: string };
  grid: { size: number; type: number };
  createEmbeddedDocuments(type: string, data: unknown[]): Promise<FoundryDocument[]>;
  delete(): Promise<Scene>;
  update(data: unknown): Promise<Scene>;
  activate(): Promise<Scene>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<Scene>;
}

declare class JournalEntry {
  static create(data: unknown, options?: unknown): Promise<JournalEntry>;
  id: string;
  name: string;
  folder: Folder | null;
  pages: Collection<FoundryDocument>;
  createEmbeddedDocuments(type: string, data: unknown[]): Promise<FoundryDocument[]>;
  delete(): Promise<JournalEntry>;
  update(data: unknown): Promise<JournalEntry>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<JournalEntry>;
}

declare class Item {
  static create(data: unknown, options?: unknown): Promise<Item>;
  id: string;
  name: string;
  type: string;
  img: string;
  folder: Folder | null;
  system: unknown;
  delete(): Promise<Item>;
  update(data: unknown): Promise<Item>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<Item>;
  toObject(): unknown;
}

declare class Playlist {
  static create(data: unknown, options?: unknown): Promise<Playlist>;
  id: string;
  name: string;
  folder: Folder | null;
  sounds: Collection<FoundryDocument>;
  delete(): Promise<Playlist>;
  update(data: unknown): Promise<Playlist>;
  getFlag(moduleId: string, key: string): unknown;
  setFlag(moduleId: string, key: string, value: unknown): Promise<Playlist>;
}

// ── getDocumentClass ──────────────────────────────────────────────────────────
// Foundry v13 utility — returns the configured document class for a given type.
// This is the reliable cross-version alternative to using globals like Folder, Actor etc.
declare function getDocumentClass(type: string): {
  create(data: unknown, options?: unknown): Promise<unknown>;
};
