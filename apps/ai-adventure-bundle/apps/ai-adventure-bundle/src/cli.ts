#!/usr/bin/env node
/**
 * ai-adventure-bundle CLI
 *
 * Takes a PDF adventure and outputs a .bundle ZIP file
 * ready to import into Foundry VTT via the ai-adventure-importer module.
 *
 * Usage:
 *   node dist/cli.js <input.pdf> [options]
 *
 * Options:
 *   --output, -o <path>      Output .bundle file (default: <input>.bundle)
 *   --system <pf2e|dnd5e>    Target game system (default: pf2e)
 *   --party-level <n>        Party level for encounter scaling (default: 5)
 *   --party-size <n>         Party size (default: 4)
 *   --mock                   Use mock AI responses (Phase 3a, default for now)
 *   --verbose, -v            Verbose progress output
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { Command } from "commander";

import { extractPdfText } from "./pdf/Extractor.js";
import { analyzeOutline } from "./pipeline/OutlineAnalyzer.js";
import { extractContent } from "./pipeline/ContentExtractor.js";
import { analyzeMaps } from "./pipeline/MapAnalyzer.js";
import { writeBundle } from "./bundle/BundleWriter.js";

interface CliOptions {
  output?: string;
  system: "pf2e" | "dnd5e" | "generic";
  partyLevel: number;
  partySize: number;
  mock: boolean;
  verbose: boolean;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("ai-adventure-bundle")
    .description("Convert a PDF adventure into a Foundry-importable .bundle file")
    .version("0.1.0")
    .argument("<input>", "Input PDF file path")
    .option("-o, --output <path>", "Output .bundle file path")
    .option("--system <system>", "Game system (pf2e|dnd5e|generic)", "pf2e")
    .option("--party-level <n>", "Party level", "5")
    .option("--party-size <n>", "Party size", "4")
    .option("--mock", "Use mock AI responses (no API calls)", true)
    .option("-v, --verbose", "Verbose output", false)
    .action(async (inputPath: string, opts: Record<string, string | boolean>) => {
      const options: CliOptions = {
        output: opts.output as string | undefined,
        system: opts.system as CliOptions["system"],
        partyLevel: parseInt(opts.partyLevel as string, 10),
        partySize: parseInt(opts.partySize as string, 10),
        mock: opts.mock !== false,
        verbose: opts.verbose === true,
      };

      await runPipeline(inputPath, options);
    });

  await program.parseAsync(process.argv);
}

async function runPipeline(inputPath: string, opts: CliOptions): Promise<void> {
  const inputAbs = resolve(inputPath);
  const outputPath = opts.output
    ? resolve(opts.output)
    : resolve(`${basename(inputPath, extname(inputPath))}.bundle`);

  log("─".repeat(60));
  log(`AI Adventure Bundle CLI v0.1.0`);
  log(`Input:    ${inputAbs}`);
  log(`Output:   ${outputPath}`);
  log(`System:   ${opts.system}`);
  log(`Mode:     ${opts.mock ? "MOCK (no API)" : "LIVE (Claude API)"}`);
  log("─".repeat(60));

  // ── Stage 1: Read PDF ──────────────────────────────────────────────────
  step("[1/5] Reading PDF...");
  const pdfBuffer = readFileSync(inputAbs);
  // PDF.js requires a strict Uint8Array, not a Node Buffer
  const pdfBytes = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
  log(`  ✓ Loaded ${(pdfBytes.length / 1024).toFixed(1)} KB`);

  // ── Stage 2: Extract text and images ───────────────────────────────────
  step("[2/5] Extracting text and images from PDF...");
  const extracted = await extractPdfText(pdfBytes);
  log(`  ✓ ${extracted.pages.length} pages parsed`);
  log(`  ✓ ${extracted.images.length} images found`);
  if (opts.verbose) {
    for (const page of extracted.pages.slice(0, 3)) {
      log(`    page ${page.pageNumber}: ${page.text.length} chars`);
    }
    if (extracted.pages.length > 3) log(`    ... +${extracted.pages.length - 3} more`);
  }

  // ── Stage 3: Analyse outline ───────────────────────────────────────────
  step("[3/5] Analysing adventure outline...");
  const outline = await analyzeOutline(extracted, {
    system: opts.system,
    partyLevel: opts.partyLevel,
    partySize: opts.partySize,
    mock: opts.mock,
  });
  log(`  ✓ Title: "${outline.title}"`);
  log(`  ✓ ${outline.chapters.length} chapter(s) identified`);

  // ── Stage 4: Extract content (rooms, NPCs, items) ──────────────────────
  step("[4/5] Extracting rooms, NPCs, items, encounters...");
  const content = await extractContent(extracted, outline, {
    system: opts.system,
    mock: opts.mock,
  });
  let totalRooms = 0,
    totalNpcs = 0,
    totalItems = 0,
    totalEncounters = 0;
  for (const ch of content.chapters) {
    totalRooms += ch.rooms.length;
    totalNpcs += ch.npcs.length;
    totalItems += ch.items.length;
    totalEncounters += ch.encounters.length;
  }
  log(`  ✓ ${totalRooms} rooms, ${totalNpcs} NPCs, ${totalItems} items, ${totalEncounters} encounters`);

  // ── Stage 5: Analyse maps (walls + lights) ─────────────────────────────
  step("[5/5] Analysing battle maps for walls and doors...");
  const withMaps = await analyzeMaps(content, extracted, { mock: opts.mock });
  let mapsAnalysed = 0;
  for (const ch of withMaps.chapters) {
    for (const room of ch.rooms) {
      if (room.map?.walls?.length) mapsAnalysed++;
    }
  }
  log(`  ✓ ${mapsAnalysed} map(s) analysed`);

  // ── Final: Write the bundle ────────────────────────────────────────────
  step("Writing .bundle file...");
  const zipBytes = await writeBundle(withMaps, extracted.images, {
    system: opts.system,
    sourcePdfFilename: basename(inputPath),
  });
  writeFileSync(outputPath, zipBytes);
  log(`  ✓ Wrote ${(zipBytes.length / 1024).toFixed(1)} KB`);

  log("─".repeat(60));
  log(`✓ Done. Drop ${basename(outputPath)} into the Foundry importer.`);
}

function log(msg: string): void {
  console.log(msg);
}

function step(msg: string): void {
  console.log(`\n${msg}`);
}

main().catch((err: unknown) => {
  console.error("\n✗ Pipeline failed:");
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
