import { MODULE_ID, TEMPLATES } from "../constants.js";
import { BundleReader, type ReadResult } from "../bundle/BundleReader.js";
import { exportCompendiumIndex } from "../export/CompendiumExporter.js";

// AppV2 factory — accessed at call time, not parse time
export function createImporterApp() {
  const { ApplicationV2, HandlebarsApplicationMixin } =
    foundry.applications.api;

  class ImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "ai-adventure-importer",
      classes: ["ai-adventure-importer"],
      tag: "div",
      window: {
        title: `${MODULE_ID}.app.title`,
        icon: "fas fa-file-import",
        resizable: false,
      },
      position: { width: 480, height: "auto" },
    };

    // Must be a separate static — HandlebarsApplicationMixin reads
    // this.constructor.PARTS directly, not DEFAULT_OPTIONS.PARTS
    static PARTS = {
      main: { template: TEMPLATES.IMPORTER_APP },
    };

    // State
    private _readResult: ReadResult | null = null;
    private _loading = false;
    private _error: string | null = null;

    static create(): ImporterApp {
      return new ImporterApp({} as ApplicationOptions);
    }

    override async _prepareContext(options: unknown) {
      const base = await super._prepareContext(options);
      return Object.assign(base, {
        loading: this._loading,
        error: this._error,
        hasBundle: this._readResult !== null,
        bundleTitle: this._readResult?.bundle.adventure.title ?? null,
        warnings: this._readResult?.warnings ?? [],
        i18n: {
          title:       game.i18n.localize(`${MODULE_ID}.app.title`),
          dropPrompt:  game.i18n.localize(`${MODULE_ID}.app.dropPrompt`),
          orClick:     game.i18n.localize(`${MODULE_ID}.app.orClick`),
          loading:     game.i18n.localize(`${MODULE_ID}.app.loading`),
          exportIndex: game.i18n.localize(`${MODULE_ID}.app.exportIndex`),
          proceed:     game.i18n.localize(`${MODULE_ID}.app.proceed`),
        },
      });
    }

    override _onRender(context: unknown, options: unknown): void {
      const el = this.element;

      const dropZone = el.querySelector<HTMLElement>(".aai-drop-zone");
      const fileInput = el.querySelector<HTMLInputElement>(".aai-file-input");

      dropZone?.addEventListener("dragover", (e: DragEvent) => {
        e.preventDefault();
        dropZone.classList.add("aai-drag-over");
      });
      dropZone?.addEventListener("dragleave", () => {
        dropZone.classList.remove("aai-drag-over");
      });
      dropZone?.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        dropZone.classList.remove("aai-drag-over");
        const file = e.dataTransfer?.files[0];
        if (file) this._handleFile(file);
      });
      dropZone?.addEventListener("click", () => fileInput?.click());
      fileInput?.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) this._handleFile(file);
      });

      el.querySelector(".aai-export-index")
        ?.addEventListener("click", () => exportCompendiumIndex());
      el.querySelector(".aai-proceed")
        ?.addEventListener("click", () => this._openReview());
    }

    private async _handleFile(file: File): Promise<void> {
      if (this._loading) return;

      const name = file.name.toLowerCase();
      if (!name.endsWith(".bundle") && !name.endsWith(".json")) {
        this._error = game.i18n.localize(`${MODULE_ID}.app.error.invalidFile`);
        this._readResult = null;
        this.render();
        return;
      }

      this._loading = true;
      this._error = null;
      this._readResult = null;
      this.render();

      try {
        this._readResult = await BundleReader.read(file);
      } catch (err) {
        this._error = (err as Error).message;
      } finally {
        this._loading = false;
        this.render();
      }
    }

    private async _openReview(): Promise<void> {
      if (!this._readResult) return;
      const { ReviewStep } = await import("./ReviewStep.js");
      const review = ReviewStep.create(this._readResult);
      review.render({ force: true });
      this.close();
    }
  }

  return ImporterApp;
}

let _ImporterAppClass: ReturnType<typeof createImporterApp> | null = null;
export const ImporterApp = new Proxy({} as ReturnType<typeof createImporterApp>, {
  get(_, prop) {
    if (!_ImporterAppClass) _ImporterAppClass = createImporterApp();
    return _ImporterAppClass[prop as keyof typeof _ImporterAppClass];
  },
});
