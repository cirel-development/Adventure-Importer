#!/usr/bin/env node
/**
 * AI Adventure MCP Server
 *
 * Exposes a set of tools to Claude Desktop so the user can ask Claude
 * to convert a PDF adventure into a Foundry .bundle file — using their
 * Pro/Max subscription, no API key needed.
 *
 * Tools exposed:
 *   read_pdf_metadata      — page count, image count, file size
 *   read_pdf_pages         — text content from a page range
 *   list_pdf_images        — image inventory with page numbers and dimensions
 *   extract_pdf_image      — fetch one image as base64 (for vision analysis)
 *   save_bundle_data       — Claude provides the assembled JSON; server caches it
 *   finalize_bundle        — write .bundle ZIP to disk with cached JSON + assets
 *
 * Architecture:
 *   Claude Desktop ──stdio──▶ this server ──fs──▶ .bundle file
 *
 * The server is stateful per-session: it caches the loaded PDF and the
 * bundle JSON Claude is building. Restart Claude Desktop = fresh session.
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  extractPdfText,
  writeBundle,
  type ExtractionResult,
  type BundleAssetSource,
} from "@ai-adventure/bundle-core";
import {
  AdventureBundleSchema,
  type AdventureBundle,
} from "@ai-adventure/bundle-schema";

// ── Per-session state ─────────────────────────────────────────────────────────
//
// Lives only as long as Claude Desktop keeps the MCP server process alive.
// One PDF loaded at a time; one bundle being assembled at a time.

interface SessionState {
  pdfPath?: string;
  pdfFilename?: string;
  extracted?: ExtractionResult;
  bundleData?: AdventureBundle;
}

const session: SessionState = {};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadPdfIfNeeded(pdfPath: string): Promise<ExtractionResult> {
  const abs = resolve(pdfPath);
  if (session.pdfPath === abs && session.extracted) {
    return session.extracted;
  }

  const buffer = readFileSync(abs);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const extracted = await extractPdfText(bytes);

  session.pdfPath = abs;
  session.pdfFilename = basename(abs);
  session.extracted = extracted;
  return extracted;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true };
}

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "ai-adventure-mcp",
  version: "0.1.0",
});

// ── Tool 1: read_pdf_metadata ────────────────────────────────────────────────

server.tool(
  "read_pdf_metadata",
  "Load a PDF adventure and return basic metadata (page count, image count, file size). Call this first before reading content.",
  { pdf_path: z.string().describe("Absolute path to the PDF file on disk") },
  async ({ pdf_path }) => {
    try {
      const extracted = await loadPdfIfNeeded(pdf_path);
      const totalChars = extracted.pages.reduce((sum, p) => sum + p.text.length, 0);

      return ok(
        JSON.stringify(
          {
            filename: session.pdfFilename,
            pageCount: extracted.pages.length,
            imageCount: extracted.images.length,
            totalTextChars: totalChars,
            estimatedTokens: Math.ceil(totalChars / 4),
          },
          null,
          2
        )
      );
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

// ── Tool 2: read_pdf_pages ───────────────────────────────────────────────────

server.tool(
  "read_pdf_pages",
  "Get the text content of a range of pages from the loaded PDF. Use small ranges (5-15 pages) to stay within context.",
  {
    pdf_path: z.string().describe("Absolute path to the PDF file"),
    start_page: z.number().int().min(1).describe("First page to read (1-indexed)"),
    end_page: z.number().int().min(1).describe("Last page to read (inclusive)"),
  },
  async ({ pdf_path, start_page, end_page }) => {
    try {
      const extracted = await loadPdfIfNeeded(pdf_path);
      if (start_page > extracted.pages.length) {
        return err(`start_page ${start_page} exceeds page count ${extracted.pages.length}`);
      }
      const realEnd = Math.min(end_page, extracted.pages.length);
      const pages = extracted.pages
        .filter((p) => p.pageNumber >= start_page && p.pageNumber <= realEnd)
        .map((p) => `=== Page ${p.pageNumber} ===\n${p.text}`)
        .join("\n\n");

      return ok(pages);
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

// ── Tool 3: list_pdf_images ──────────────────────────────────────────────────

server.tool(
  "list_pdf_images",
  "List all images extracted from the PDF with their IDs, page numbers, and dimensions. Use this to find maps and portraits.",
  { pdf_path: z.string().describe("Absolute path to the PDF file") },
  async ({ pdf_path }) => {
    try {
      const extracted = await loadPdfIfNeeded(pdf_path);
      const summary = extracted.images.map((img) => ({
        id: img.id,
        page: img.pageNumber,
        width: img.width,
        height: img.height,
        aspectRatio: (img.width / img.height).toFixed(2),
      }));
      return ok(JSON.stringify(summary, null, 2));
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

// ── Tool 4: extract_pdf_image ────────────────────────────────────────────────

server.tool(
  "extract_pdf_image",
  "Extract a single image from the PDF as base64-encoded WebP for vision analysis. Use this to inspect maps and portraits.",
  {
    pdf_path: z.string().describe("Absolute path to the PDF file"),
    image_id: z.string().describe("Image ID from list_pdf_images"),
  },
  async ({ pdf_path, image_id }) => {
    try {
      const extracted = await loadPdfIfNeeded(pdf_path);
      const img = extracted.images.find((i) => i.id === image_id);
      if (!img) return err(`image "${image_id}" not found`);

      // Convert raw pixel data to a sendable image (PNG via Sharp)
      const sharp = (await import("sharp")).default;
      const buf = await sharp(img.data, {
        raw: { width: img.width, height: img.height, channels: img.channels },
      })
        .webp({ quality: 80 })
        .toBuffer();

      const base64 = buf.toString("base64");
      return {
        content: [
          {
            type: "image" as const,
            data: base64,
            mimeType: "image/webp",
          },
        ],
      };
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

// ── Tool 5: save_bundle_data ─────────────────────────────────────────────────

server.tool(
  "save_bundle_data",
  "Save the assembled adventure JSON. Claude provides this after analysing the PDF. Validates against the bundle schema and reports any issues.",
  {
    bundle_json: z
      .string()
      .describe("The complete adventure bundle as a JSON string"),
  },
  async ({ bundle_json }) => {
    try {
      const parsed = JSON.parse(bundle_json) as unknown;
      const result = AdventureBundleSchema.safeParse(parsed);

      if (!result.success) {
        const issues = result.error.issues.map(
          (i) => `  ${i.path.join(".")}: ${i.message}`
        );
        return err(`Schema validation failed:\n${issues.slice(0, 20).join("\n")}`);
      }

      session.bundleData = result.data;
      return ok(
        `Bundle data saved. ${result.data.chapters.length} chapter(s), ` +
          `${result.data.chapters.reduce((s, c) => s + c.rooms.length, 0)} room(s), ` +
          `${result.data.assets.length} asset reference(s).\n` +
          `Call finalize_bundle next to write the .bundle file.`
      );
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

// ── Tool 6: finalize_bundle ──────────────────────────────────────────────────

server.tool(
  "finalize_bundle",
  "Write the .bundle ZIP file to disk using the saved bundle data, embedding any images referenced from the loaded PDF.",
  {
    output_path: z
      .string()
      .describe("Where to write the .bundle file (absolute path)"),
  },
  async ({ output_path }) => {
    try {
      if (!session.bundleData) {
        return err("No bundle data saved yet. Call save_bundle_data first.");
      }

      // Match referenced assets to PDF images by ID
      const sources: BundleAssetSource[] = [];
      if (session.extracted) {
        const refIds = new Set<string>();
        for (const ch of session.bundleData.chapters) {
          for (const r of ch.rooms) if (r.mapAssetId) refIds.add(r.mapAssetId);
          for (const n of ch.npcs) if (n.portraitAssetId) refIds.add(n.portraitAssetId);
          for (const h of ch.handouts) if (h.assetId) refIds.add(h.assetId);
        }
        for (const img of session.extracted.images) {
          if (refIds.has(img.id)) {
            sources.push({
              id: img.id,
              bytes: img.data,
              raw: { width: img.width, height: img.height, channels: img.channels },
            });
          }
        }
      }

      const { zipBytes, warnings } = await writeBundle(session.bundleData, sources);

      const outPath = resolve(output_path);
      await writeFile(outPath, zipBytes);

      return ok(
        `Wrote ${(zipBytes.length / 1024).toFixed(1)} KB to ${outPath}\n` +
          `Embedded ${sources.length} asset(s).\n` +
          (warnings.length
            ? `Warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`
            : `No warnings.`)
      );
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Critical: stdio server MUST log to stderr only — stdout carries JSON-RPC
  console.error("ai-adventure-mcp server ready");
}

main().catch((err) => {
  console.error("ai-adventure-mcp server crashed:", err);
  process.exit(1);
});
