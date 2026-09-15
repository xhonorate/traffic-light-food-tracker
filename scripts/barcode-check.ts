// Checks that the WASM barcode decoder the scanner falls back to (every
// iPhone, and any Android without a built-in detector) reads product barcodes
// out of camera-like frames rather than only perfect, generated images.
// Run with `npm run test:barcode`. No network: the WASM is read from disk.
//
// Each case renders a real EAN/UPC symbol into a 1280x720 frame the way a
// phone sees it -- small in the frame, off-white paper, grey rather than black
// bars, sensor noise, soft focus, and optionally tilted -- then decodes it
// with the exact function the app uses.
import { readFileSync } from "node:fs";
import { prepareZXingModule as prepareReader } from "zxing-wasm/reader";
import { prepareZXingModule as prepareWriter, writeBarcode } from "zxing-wasm/writer";
import { decodeWithZxing } from "../src/lib/barcode";

prepareReader({
  overrides: { wasmBinary: readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm") },
});
prepareWriter({
  overrides: { wasmBinary: readFileSync("node_modules/zxing-wasm/dist/writer/zxing_writer.wasm") },
});

const W = 1280;
const H = 720;

/** Deterministic noise, so a failure reproduces. */
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

interface Scene {
  label: string;
  format: "EAN13" | "UPCA" | "EAN8" | "UPCE";
  text: string;
  /** Another reading of the same code that counts as correct. */
  also?: string;
  /** Pixels per bar module. A 95-module EAN-13 at 3px is 285px wide, under a
   *  quarter of the frame. */
  module: number;
  tiltDeg?: number;
  blur?: number;
  noise?: number;
  /** Vertical barcode, as when a box is held sideways. */
  sideways?: boolean;
}

async function render(scene: Scene) {
  const { symbol } = await writeBarcode(scene.text, { format: scene.format, scale: 1, addQuietZones: true });
  const barHeight = Math.round(scene.module * 30);

  // Background: slightly uneven off-white paper.
  const grey = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) grey[y * W + x] = 205 + 20 * (x / W) - 15 * (y / H);
  }

  // Place the symbol at the centre, rotated about it.
  const angle = ((scene.tiltDeg ?? 0) + (scene.sideways ? 90 : 0)) * (Math.PI / 180);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const sw = symbol.width * scene.module;
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Inverse-map the frame pixel into symbol space.
      const dx = x - cx, dy = y - cy;
      const u = cos * dx + sin * dy + sw / 2;
      const v = -sin * dx + cos * dy + barHeight / 2;
      if (u < 0 || v < 0 || u >= sw || v >= barHeight) continue;
      const col = Math.floor(u / scene.module);
      const dark = symbol.data[col] < 128; // one-row symbol: every row is the same
      grey[y * W + x] = dark ? 55 : 225;
    }
  }

  // Soft focus: repeated box blur approximates a Gaussian.
  for (let pass = 0; pass < (scene.blur ?? 0); pass++) {
    const out = new Float32Array(grey.length);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let s = 0;
        for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) s += grey[(y + ky) * W + x + kx];
        out[y * W + x] = s / 9;
      }
    }
    grey.set(out);
  }

  const data = new Uint8ClampedArray(W * H * 4);
  const noise = scene.noise ?? 0;
  for (let i = 0; i < W * H; i++) {
    const v = grey[i] + (rand() - 0.5) * 2 * noise;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

const scenes: Scene[] = [
  { label: "EAN-13, clean", format: "EAN13", text: "5000112637922", module: 3 },
  { label: "EAN-13, noisy and soft", format: "EAN13", text: "5000112637922", module: 3, noise: 25, blur: 2 },
  { label: "UPC-A (US grocery), noisy and soft", format: "UPCA", text: "016000275287", module: 3, noise: 25, blur: 2 },
  { label: "UPC-A, small in frame (2px modules)", format: "UPCA", text: "049000000443", module: 2, noise: 15, blur: 1 },
  { label: "UPC-A, tilted 12 degrees", format: "UPCA", text: "016000275287", module: 3, tiltDeg: 12, noise: 15, blur: 1 },
  { label: "EAN-13, held sideways", format: "EAN13", text: "5000112637922", module: 3, sideways: true, noise: 15, blur: 1 },
  { label: "EAN-8, noisy", format: "EAN8", text: "96385074", module: 3, noise: 20, blur: 1 },
  // zxing reports UPC-E expanded to its full GTIN, which is also how the food
  // databases key such products.
  { label: "UPC-E, noisy", format: "UPCE", text: "01234565", also: "0012345000065", module: 3, noise: 20, blur: 1 },
];

const failures: string[] = [];
let checks = 0;

for (const scene of scenes) {
  checks += 1;
  const frame = await render(scene);
  const got = await decodeWithZxing(frame);
  // UPC-A may legitimately come back as its 13-digit EAN form.
  const ok = got === scene.text || got === `0${scene.text}` || got === scene.also;
  if (!ok) failures.push(`  ${scene.label}: got ${JSON.stringify(got)}, expected ${scene.text}`);
}

// A frame with no barcode must decode to nothing, not a hallucinated number.
checks += 1;
const empty = await render({ label: "empty", format: "EAN13", text: "5000112637922", module: 0.0001, noise: 30, blur: 1 });
const ghost = await decodeWithZxing(empty);
if (ghost !== null) failures.push(`  empty frame: got ${JSON.stringify(ghost)}, expected null`);

if (failures.length) {
  console.log(`Barcode: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Barcode: all ${checks} checks pass`);
