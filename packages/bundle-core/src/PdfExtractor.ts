/**
 * PDF Extractor
 *
 * Uses pdfjs-dist (PDF.js) to extract text and embedded images from a PDF.
 * Runs in Node.js — no DOM/canvas dependencies for text extraction.
 *
 * Outputs structured per-page text and a deduplicated list of raw image bytes
 * that downstream stages can convert/embed.
 */

// PDF.js legacy build is an ES module — use dynamic import() so this works
// across Node versions (newer Node refuses require() of ESM).
interface PdfJsLib {
  getDocument: (args: { data: Uint8Array }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}

interface PdfPage {
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get: (id: string, cb: (obj: unknown) => void) => void; has: (id: string) => boolean };
  commonObjs: { get: (id: string, cb: (obj: unknown) => void) => void; has: (id: string) => boolean };
  view: number[]; // [x, y, width, height]
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  imageRefs: string[]; // image object IDs referenced on this page
}

export interface ExtractedImage {
  id: string;          // unique ID per image
  pageNumber: number;  // page where first encountered
  width: number;
  height: number;
  data: Uint8Array;    // raw pixel data (RGBA or RGB, see channels)
  channels: 3 | 4;     // 3=RGB, 4=RGBA
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  images: ExtractedImage[];
}

/**
 * Extract structured text and images from a PDF buffer.
 *
 * @param pdfBytes - Raw PDF file bytes
 * @returns Per-page text and deduplicated image list
 */
export async function extractPdfText(pdfBytes: Uint8Array): Promise<ExtractionResult> {
  // Dynamic import works for both CJS-style and ESM packages, in any Node version.
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsLib;

  const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;

  const pages: ExtractedPage[] = [];
  const images: ExtractedImage[] = [];
  const seenImageIds = new Set<string>();

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);

    // ── Text extraction ───────────────────────────────────────────────
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // PDF.js returns view as [x1, y1, x2, y2] — width = x2-x1, height = y2-y1
    const [, , x2, y2] = page.view;
    const width = Math.abs(x2 - page.view[0]);
    const height = Math.abs(y2 - page.view[1]);

    // ── Image extraction ──────────────────────────────────────────────
    const imageRefs = await extractImagesFromPage(page, pageNum, images, seenImageIds);

    pages.push({
      pageNumber: pageNum,
      text,
      width,
      height,
      imageRefs,
    });
  }

  await doc.destroy();
  return { pages, images };
}

/**
 * Walk a page's operator list looking for image-paint commands,
 * resolve the image objects, and stash unique ones in the images array.
 *
 * Returns the image IDs referenced on this page.
 */
async function extractImagesFromPage(
  page: PdfPage,
  pageNumber: number,
  images: ExtractedImage[],
  seenImageIds: Set<string>
): Promise<string[]> {
  const ops = await page.getOperatorList();
  const refs: string[] = [];

  // PDF.js operator IDs we care about:
  // OPS.paintImageXObject = 85, OPS.paintInlineImageXObject = 86, OPS.paintJpegXObject = 82
  const PAINT_IMAGE_OPS = new Set([82, 85, 86]);

  for (let i = 0; i < ops.fnArray.length; i++) {
    if (!PAINT_IMAGE_OPS.has(ops.fnArray[i])) continue;

    const args = ops.argsArray[i];
    const imgId = typeof args?.[0] === "string" ? args[0] : null;
    if (!imgId) continue;

    refs.push(imgId);

    // Skip if we've already extracted this image
    if (seenImageIds.has(imgId)) continue;
    seenImageIds.add(imgId);

    // Try resolving from the page's objs cache, then commonObjs
    const img = await resolveImage(page, imgId);
    if (!img) continue;

    const { width, height, data, kind } = img as {
      width?: number;
      height?: number;
      data?: Uint8ClampedArray | Uint8Array;
      kind?: number;
    };

    if (!width || !height || !data) continue;

    // PDF.js ImageKind: 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP
    const channels: 3 | 4 = kind === 3 ? 4 : 3;

    images.push({
      id: imgId,
      pageNumber,
      width,
      height,
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      channels,
    });
  }

  return refs;
}

/**
 * Resolve an image object by ID from either page-local or common object stores.
 * Wraps the callback-based PDF.js API in a promise.
 */
function resolveImage(page: PdfPage, imgId: string): Promise<unknown | null> {
  return new Promise((resolveP) => {
    const tryGet = (store: PdfPage["objs"]): boolean => {
      try {
        if (!store.has(imgId)) return false;
        store.get(imgId, (obj: unknown) => resolveP(obj ?? null));
        return true;
      } catch {
        return false;
      }
    };

    if (tryGet(page.objs)) return;
    if (tryGet(page.commonObjs)) return;
    resolveP(null);
  });
}
