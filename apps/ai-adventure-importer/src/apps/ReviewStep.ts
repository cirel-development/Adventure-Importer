import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { ReadResult } from "../bundle/BundleReader.js";
import type { AdventureBundle } from "@ai-adventure/bundle-schema";

export function createReviewStep() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  class ReviewStep extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "ai-adventure-review",
      classes: ["ai-adventure-importer", "ai-adventure-review"],
      tag: "div",
      window: {
        title: `${MODULE_ID}.review.title`,
        icon: "fas fa-list-check",
        resizable: true,
      },
      position: { width: 600, height: "auto" },
    };

    static PARTS = {
      main: { template: TEMPLATES.REVIEW_STEP },
    };

    private _readResult: ReadResult;
    private _summary: BundleSummary;

    constructor(readResult: ReadResult, options?: ApplicationOptions) {
      super(options);
      this._readResult = readResult;
      this._summary = summarise(readResult.bundle);
    }

    static create(readResult: ReadResult): ReviewStep {
      return new ReviewStep(readResult);
    }

    override async _prepareContext(options: unknown) {
      const base = await super._prepareContext(options);
      const { bundle, warnings } = this._readResult;
      return Object.assign(base, {
        title:    bundle.adventure.title,
        synopsis: bundle.adventure.synopsis,
        system:   bundle.meta.system,
        warnings,
        summary:  this._summary,
        i18n: {
          title:   game.i18n.localize(`${MODULE_ID}.review.title`),
          proceed: game.i18n.localize(`${MODULE_ID}.review.proceed`),
          cancel:  game.i18n.localize(`${MODULE_ID}.review.cancel`),
        },
      });
    }

    override _onRender(_context: unknown, _options: unknown): void {
      const el = this.element;
      el.querySelector(".aai-build")?.addEventListener("click", () => this._startBuild());
      el.querySelector(".aai-cancel")?.addEventListener("click", () => this.close());
    }

    private async _startBuild(): Promise<void> {
      const { BuildStep } = await import("./BuildStep.js");
      const build = BuildStep.create(this._readResult);
      build.render({ force: true });
      this.close();
    }
  }

  return ReviewStep;
}

interface BundleSummary {
  chapters: number; scenes: number; actors: number;
  journals: number; items: number; hazards: number;
  handouts: number; lowConfidence: number;
}

function summarise(bundle: AdventureBundle): BundleSummary {
  let scenes = 0, actors = 0, journals = 0, items = 0,
      hazards = 0, handouts = 0, lowConfidence = 0;

  for (const chapter of bundle.chapters) {
    for (const room of chapter.rooms) {
      if (room.map) scenes++;
      journals += 5;
    }
    for (const npc of chapter.npcs) {
      actors++;
      if (npc.statBlock && npc.statBlock.confidenceScore < 0.6) lowConfidence++;
    }
    items    += chapter.items.length;
    hazards  += chapter.hazards.filter(h => h.destination !== "journal").length;
    handouts += chapter.handouts.length;
  }

  return { chapters: bundle.chapters.length, scenes, actors, journals,
           items, hazards, handouts, lowConfidence };
}

let _ReviewStepClass: ReturnType<typeof createReviewStep> | null = null;
export const ReviewStep = new Proxy({} as ReturnType<typeof createReviewStep>, {
  get(_, prop) {
    if (!_ReviewStepClass) _ReviewStepClass = createReviewStep();
    return _ReviewStepClass[prop as keyof typeof _ReviewStepClass];
  },
});
