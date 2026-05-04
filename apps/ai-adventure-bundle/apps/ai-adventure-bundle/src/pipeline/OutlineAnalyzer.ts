/**
 * Outline Analyzer
 *
 * Stage 1 of content extraction.
 * Takes the raw PDF text, asks AI to identify:
 *   - Adventure title and synopsis
 *   - Chapter/act divisions and their page ranges
 *
 * Output is the high-level outline that subsequent stages use to
 * scope their work (e.g. "extract rooms from chapter 2, pages 12-18").
 */

import type { ExtractionResult } from "../pdf/Extractor.js";
import { createAiClient } from "../ai/Client.js";

export interface OutlineChapter {
  id: string;
  title: string;
  synopsis?: string;
  startPage: number;
  endPage: number;
}

export interface AdventureOutline {
  title: string;
  slug: string;
  synopsis: string;
  tone?: string;
  chapters: OutlineChapter[];
}

export interface OutlineOptions {
  system: "pf2e" | "dnd5e" | "generic";
  partyLevel: number;
  partySize: number;
  mock: boolean;
  apiKey?: string;
}

/**
 * Run outline analysis on extracted PDF data.
 */
export async function analyzeOutline(
  extracted: ExtractionResult,
  opts: OutlineOptions
): Promise<AdventureOutline> {
  const ai = createAiClient({ mock: opts.mock, apiKey: opts.apiKey });

  // Concatenate first ~10 pages of text for the outline pass.
  // Real adventures usually have title, intro, and TOC in the first chunk.
  const headerText = extracted.pages
    .slice(0, 10)
    .map((p) => `=== Page ${p.pageNumber} ===\n${p.text}`)
    .join("\n\n");

  const prompt = buildOutlinePrompt(headerText, opts);
  const responseText = await ai.generateText({
    prompt,
    system: SYSTEM_PROMPT,
    jsonMode: true,
    maxTokens: 2000,
  });

  return parseOutlineResponse(responseText, extracted);
}

const SYSTEM_PROMPT = `You are a tabletop RPG adventure analyst. Your job is to identify the high-level structure of an adventure module from its text. Output strict JSON only — no preamble, no markdown fences.`;

function buildOutlinePrompt(text: string, opts: OutlineOptions): string {
  return `[MOCK:outline]
Analyse this ${opts.system.toUpperCase()} adventure for party level ${opts.partyLevel}.

Identify:
1. The adventure title and a 1-2 sentence synopsis.
2. Tone (heroic, gritty, horror, comedic, etc).
3. Chapter or act structure with page ranges.

Output JSON in exactly this shape:
{
  "title": "string",
  "slug": "kebab-case-slug",
  "synopsis": "string",
  "tone": "string",
  "chapters": [
    { "id": "chapter-1", "title": "string", "synopsis": "string", "startPage": 1, "endPage": 5 }
  ]
}

Adventure text:
${text}`;
}

/**
 * Parse the AI's JSON response into an AdventureOutline.
 * Falls back to a single-chapter outline spanning the whole PDF
 * if parsing fails or chapters are missing.
 */
function parseOutlineResponse(
  raw: string,
  extracted: ExtractionResult
): AdventureOutline {
  const parsed = safeJsonParse(raw);

  const title = typeof parsed.title === "string" ? parsed.title : "Untitled Adventure";
  const slug =
    typeof parsed.slug === "string" && /^[a-z0-9-]+$/.test(parsed.slug)
      ? parsed.slug
      : slugify(title);
  const synopsis = typeof parsed.synopsis === "string" ? parsed.synopsis : "";
  const tone = typeof parsed.tone === "string" ? parsed.tone : undefined;

  let chapters: OutlineChapter[] = [];
  if (Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
    chapters = parsed.chapters.map((c: unknown, i: number) =>
      normaliseChapter(c, i, extracted.pages.length)
    );
  } else {
    // Fallback: single chapter covering whole PDF
    chapters = [
      {
        id: "chapter-1",
        title: "The Adventure",
        startPage: 1,
        endPage: extracted.pages.length,
      },
    ];
  }

  return { title, slug, synopsis, tone, chapters };
}

function normaliseChapter(c: unknown, index: number, totalPages: number): OutlineChapter {
  const obj = (c ?? {}) as Record<string, unknown>;
  const id =
    typeof obj.id === "string" && /^[a-z0-9-]+$/.test(obj.id)
      ? obj.id
      : `chapter-${index + 1}`;
  const title = typeof obj.title === "string" ? obj.title : `Chapter ${index + 1}`;
  const synopsis = typeof obj.synopsis === "string" ? obj.synopsis : undefined;
  const startPage = clamp(toInt(obj.startPage, 1), 1, totalPages);
  const endPage = clamp(toInt(obj.endPage, totalPages), startPage, totalPages);
  return { id, title, synopsis, startPage, endPage };
}

// ── Utilities ────────────────────────────────────────────────────────────

function safeJsonParse(raw: string): Record<string, unknown> {
  // Strip markdown fences if the model added them despite instructions
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function toInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
