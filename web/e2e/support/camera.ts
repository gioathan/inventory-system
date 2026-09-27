import bwipjs from "bwip-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PNG } from "pngjs";

const W = 640;
const H = 480;
const FRAMES = 10;

// Renders a barcode or QR code to a looping Y4M video, which Chromium's fake camera can play
// (--use-file-for-fake-video-capture). That lets the tests exercise the real camera -> decode ->
// lookup path in a headless browser with no physical camera.
export async function makeY4m(kind: "code128" | "qrcode", text: string, out: string) {
  const png = PNG.sync.read(
    await bwipjs.toBuffer({
      bcid: kind,
      text,
      scale: kind === "qrcode" ? 8 : 3,
      ...(kind === "qrcode" ? {} : { height: 18 }),
      includetext: false,
      paddingwidth: 6,
      paddingheight: 6,
      backgroundcolor: "FFFFFF",
    }),
  );

  // White canvas, code centered.
  const rgb = new Uint8Array(W * H * 3).fill(255);
  const ox = Math.floor((W - png.width) / 2);
  const oy = Math.floor((H - png.height) / 2);
  if (ox < 0 || oy < 0) throw new Error(`image ${png.width}x${png.height} doesn't fit ${W}x${H}`);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const s = (y * png.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 3;
      rgb[d] = png.data[s];
      rgb[d + 1] = png.data[s + 1];
      rgb[d + 2] = png.data[s + 2];
    }
  }

  // RGB -> planar I420 (BT.601, full range), chroma averaged over 2x2 blocks.
  const Y = Buffer.alloc(W * H);
  const U = Buffer.alloc((W / 2) * (H / 2));
  const V = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      Y[y * W + x] = Math.round(0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]);
    }
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W / 2; x++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * W + (x * 2 + dx)) * 3;
        r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2];
      }
      r /= 4; g /= 4; b /= 4;
      U[y * (W / 2) + x] = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      V[y * (W / 2) + x] = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }

  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat([header, ...Array<Buffer>(FRAMES).fill(frame)]));
}
