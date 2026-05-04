import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { ReadResult } from "../bundle/BundleReader.js";
import type { UndoManager } from "../undo/UndoManager.js";

export function createBuildStep() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  class BuildStep extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "ai-adventure-build",
      classes: ["ai-adventure-importer", "ai-adventure-build"],
      tag: "div",
      window: { title: `${MODULE_ID}.build.title`, icon: "fas fa-hammer", resizable: false },
      position: { width: 480, height: "auto" },
    };

    static PARTS = {
      main: { template: TEMPLATES.BUILD_STEP },
    };

    private _readResult: ReadResult;
    private _undo: UndoManager | null = null;
    private _progress: BuildProgress = {
      phase: "idle", done: 0, total: 7, currentLabel: "", errors: [],
    };

    constructor(readResult: ReadResult, options?: ApplicationOptions) {
      super(options);
      this._readResult = readResult;
    }

    static create(readResult: ReadResult): BuildStep {
      return new BuildStep(readResult);
    }

    override async _prepareContext(options: unknown) {
      const base = await super._prepareContext(options);
      return Object.assign(base, {
        progress: this._progress,
        progressPct: this._progress.total > 0 ? Math.round((this._progress.done / this._progress.total) * 100) : 0,
        canUndo: this._undo !== null && this._progress.phase === "done",
        i18n: {
          title: game.i18n.localize(`${MODULE_ID}.build.title`),
          undo:  game.i18n.localize(`${MODULE_ID}.build.undo`),
          close: game.i18n.localize(`${MODULE_ID}.build.close`),
        },
      });
    }

    override _onRender(_context: unknown, _options: unknown): void {
      const el = this.element;
      el.querySelector(".aai-undo")?.addEventListener("click", () => this._runUndo());
      el.querySelector(".aai-close-build")?.addEventListener("click", () => this.close());
    }

    override async render(options?: { force?: boolean }): Promise<void> {
      await super.render(options);
      if (this._progress.phase === "idle") {
        void this._startBuild();
      }
    }

    private async _startBuild(): Promise<void> {
      const { BuildPipeline } = await import("../builders/BuildPipeline.js");
      this._undo = await BuildPipeline.run(
        this._readResult,
        (update) => {
          Object.assign(this._progress, update);
          this.render();
        }
      );
    }

    private async _runUndo(): Promise<void> {
      if (!this._undo) return;
      const preview = this._undo.preview();
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize(`${MODULE_ID}.build.undoTitle`),
        content: buildUndoConfirmHtml(this._undo.adventureName, preview),
        yes: () => true,
        no:  () => false,
      });
      if (!confirmed) return;

      this._progress = { ...this._progress, phase: "folders", currentLabel: "Undoing…" };
      this.render();

      const result = await this._undo.undoAll((done, total, entry) => {
        this._progress.currentLabel = `Deleting ${entry.name}…`;
        this._progress.done = done;
        this._progress.total = total;
        this.render();
      });

      const summary = `Removed ${result.deleted} entities.` +
        (result.notFound > 0 ? ` ${result.notFound} already missing.` : "") +
        (result.errors.length > 0 ? ` ${result.errors.length} errors.` : "");

      ui.notifications.info(summary);
      this.close();
    }
  }

  return BuildStep;
}

function buildUndoConfirmHtml(
  adventureName: string,
  preview: { byType: Record<string, number>; total: number }
): string {
  const rows = Object.entries(preview.byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `<li>${count} ${type}${count !== 1 ? "s" : ""}</li>`)
    .join("");
  return `<p>This will permanently delete everything created by <strong>${adventureName}</strong>:</p><ul>${rows}</ul><p><em>Manual edits to these entities will also be lost.</em></p>`;
}

export interface BuildProgress {
  phase: "idle" | "folders" | "journals" | "actors" | "items" | "scenes" | "link" | "done" | "error";
  done: number;
  total: number;
  currentLabel: string;
  errors: string[];
}

declare const Dialog: {
  confirm(options: { title: string; content: string; yes: () => boolean; no: () => boolean }): Promise<boolean>;
};

let _BuildStepClass: ReturnType<typeof createBuildStep> | null = null;
export const BuildStep = new Proxy({} as ReturnType<typeof createBuildStep>, {
  get(_, prop) {
    if (!_BuildStepClass) _BuildStepClass = createBuildStep();
    return _BuildStepClass[prop as keyof typeof _BuildStepClass];
  },
});
