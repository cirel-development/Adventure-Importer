import { unzipSync, strFromU8 } from "fflate";
import {
  AdventureBundleSchema,
  isSchemaMajorCompatible,
  BUNDLE_SCHEMA_VERSION,
  type AdventureBundle,
} from "@ai-adventure/bundle-schema";
import { MODULE_ID, UPLOADS_ROOT } from "../constants.js";

export interface ReadResult {
  bundle: AdventureBundle;
  /** Foundry-relative paths for each asset id after upload */
  assetPaths: Map<string, string>;
  /** Non-fatal warnings to surface in the review step */
  warnings: string[];
}

export class BundleReader {
  /**
   * Accept either a .bundle ZIP file or raw JSON (from Claude.ai paste).
   * Returns validated bundle data and uploads all assets to Foundry.
   */
  static async read(file: File): Promise<ReadResult> {
    const warnings: string[] = [];

    // Detect ZIP by magic bytes (PK\x03\x04) vs JSON
    const header = await readBytes(file, 4);
    const isZip =
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04;

    let bundleJson: unknown;
    const assetFiles = new Map<string, Uint8Array>(); // filename → bytes

    if (isZip) {
      const buf = await file.arrayBuffer();
      const entries = unzipSync(new Uint8Array(buf));

      const jsonEntry = entries["bundle.json"];
      if (!jsonEntry) {
        throw new Error("bundle.json not found in ZIP — is this a valid .bundle file?");
      }
      bundleJson = JSON.parse(strFromU8(jsonEntry));

      // Collect all assets/ entries
      for (const [name, bytes] of Object.entries(entries)) {
        if (name.startsWith("assets/") && name !== "assets/") {
          assetFiles.set(name.replace("assets/", ""), bytes);
        }
      }
    } else {
      // Raw JSON (Claude.ai path — no assets embedded)
      const text = await file.text();
      try {
        bundleJson = JSON.parse(text);
      } catch {
        throw new Error("File is neither a valid .bundle ZIP nor valid JSON.");
      }
      warnings.push(
        "No asset images found. Any map/portrait references will use placeholder images. " +
        "Use a .bundle ZIP for full asset support."
      );
    }

    // Schema version check before full parse (better error message)
    const raw = bundleJson as Record<string, unknown>;
    const bundleVersion = raw.schema as string | undefined;
    if (!bundleVersion) {
      throw new Error('bundle.json missing "schema" field.');
    }
    if (!isSchemaMajorCompatible(bundleVersion)) {
      throw new Error(
        `Bundle schema v${bundleVersion} is incompatible with this importer ` +
        `(supports v${BUNDLE_SCHEMA_VERSION}). Re-generate the bundle with a ` +
        `compatible version of ai-adventure-bundle.`
      );
    }

    // Full Zod validation
    const result = AdventureBundleSchema.safeParse(bundleJson);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map(i => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Bundle validation failed:\n${issues}`);
    }
    const bundle = result.data;

    // Upload assets to Foundry
    const assetPaths = await BundleReader.uploadAssets(
      bundle.adventure.slug,
      assetFiles,
      warnings
    );

    return { bundle, assetPaths, warnings };
  }

  /**
   * Upload asset files to `uploads/{root}/{slug}/assets/` in Foundry user data.
   * Returns a map from asset filename → Foundry-relative path.
   */
  private static async uploadAssets(
    slug: string,
    files: Map<string, Uint8Array>,
    warnings: string[]
  ): Promise<Map<string, string>> {
    const paths = new Map<string, string>();
    if (files.size === 0) return paths;

    const uploadDir = `${UPLOADS_ROOT}/${slug}/assets`;
    await ensureDirectory(uploadDir);

    for (const [filename, bytes] of files) {
      const mime = mimeFromFilename(filename);
      const file = new File([bytes.buffer as ArrayBuffer], filename, { type: mime });
      try {
        const result = await ((foundry as any).applications.apps.FilePicker.implementation).upload("data", uploadDir, file, {});
        paths.set(filename, result.path);
      } catch (err) {
        warnings.push(`Failed to upload asset "${filename}": ${(err as Error).message}`);
      }
    }

    return paths;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBytes(file: File, count: number): Promise<Uint8Array> {
  const slice = file.slice(0, count);
  return new Uint8Array(await slice.arrayBuffer());
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await ((foundry as any).applications.apps.FilePicker.implementation).createDirectory("data", path, {});
  } catch {
    // Directory already exists — ignore
  }
}

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    webp: "image/webp",
    png:  "image/png",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    gif:  "image/gif",
    mp3:  "audio/mpeg",
    ogg:  "audio/ogg",
    wav:  "audio/wav",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}
