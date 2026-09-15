import { readBarcodes, type ReaderOptions } from "zxing-wasm/reader";

/**
 * Reading product barcodes from camera frames and photos.
 *
 * Two decoders, best first:
 *
 * - The browser's own `BarcodeDetector`, where it exists and knows EAN-13.
 *   On Android Chrome that is Google's ML Kit, which copes with blur, glare
 *   and angles far better than anything that ships in a web page.
 * - zxing-cpp compiled to WebAssembly everywhere else, notably iPhones, whose
 *   browsers have no detector at all. The WASM file is served from our own
 *   origin (see BarcodeScanner), never a CDN.
 *
 * Only EAN/UPC are read: those are what grocery packaging carries, what the
 * food databases are keyed on, and limiting formats stops a shipping label's
 * Code 128 being mistaken for a product.
 */

const ZXING_OPTIONS: ReaderOptions = {
  formats: ["EAN13", "EAN8", "UPCA", "UPCE"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  maxNumberOfSymbols: 1,
};

/** Decode a product barcode from raw RGBA pixels with zxing. Exported
 *  separately so it can be checked outside a browser. */
export async function decodeWithZxing(
  image: { data: Uint8ClampedArray; width: number; height: number },
): Promise<string | null> {
  const [hit] = await readBarcodes(image as ImageData, ZXING_OPTIONS);
  return hit?.isValid && hit.text ? hit.text : null;
}

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

/** The slice of the Shape Detection API used here; TypeScript's DOM types do
 *  not include it yet. */
interface NativeDetector {
  detect(source: CanvasImageSource | ImageBitmap): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

let nativeDetector: Promise<NativeDetector | null> | null = null;

/** The built-in detector, or null where there is none or it cannot read
 *  EAN-13 (some Android builds report no formats when Play Services lacks the
 *  barcode module). */
function getNativeDetector(): Promise<NativeDetector | null> {
  nativeDetector ??= (async () => {
    const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
    if (!Detector) return null;
    try {
      const supported = await Detector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      return formats.includes("ean_13") ? new Detector({ formats }) : null;
    } catch {
      return null;
    }
  })();
  return nativeDetector;
}

/** Which decoder live scanning will use, for diagnostics. */
export async function decoderName(): Promise<"native" | "zxing"> {
  return (await getNativeDetector()) ? "native" : "zxing";
}

/** Largest dimension a frame or photo is decoded at. Enough detail for a
 *  barcode across a third of a 12 MP photo, without copying 48 MB of pixels. */
const MAX_DECODE_SIDE = 2400;

/** Draw a source to a canvas no larger than `MAX_DECODE_SIDE`. */
function toCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement = document.createElement("canvas"),
): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function zxingFromCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return decodeWithZxing(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

/**
 * Read one live video frame. Pass the same canvas every call so frames do not
 * allocate. Returns null when no barcode is in view, which is the normal case.
 */
export async function scanVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const native = await getNativeDetector();
  if (native) {
    try {
      const [hit] = await native.detect(video);
      return hit?.rawValue?.trim() || null;
    } catch {
      // A detector that errors on frames is no use; use zxing from now on.
      nativeDetector = Promise.resolve(null);
    }
  }
  return zxingFromCanvas(toCanvas(video, video.videoWidth, video.videoHeight, canvas));
}

/**
 * Read a still photo. Both decoders get a go, since a still is a one-off and
 * the second opinion costs well under a second.
 */
export async function scanPhoto(file: Blob): Promise<string | null> {
  // createImageBitmap applies the photo's EXIF rotation and decodes HEIC on
  // iPhones, neither of which the WASM decoder would do on its own.
  const bitmap = await createImageBitmap(file);
  try {
    const native = await getNativeDetector();
    if (native) {
      const [hit] = await native.detect(bitmap).catch(() => []);
      if (hit?.rawValue) return hit.rawValue.trim();
    }
    return await zxingFromCanvas(toCanvas(bitmap, bitmap.width, bitmap.height));
  } finally {
    bitmap.close();
  }
}
