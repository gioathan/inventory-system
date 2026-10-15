// Pictures are shrunk in the browser before they are uploaded. They are for recognising an item
// on a screen, not for print, and with thousands of items every kilobyte in the bucket counts —
// so a 6 MB phone photo goes up as roughly a hundred kilobytes.
//
// The server enforces its own cap (R2Images:MaxBytes, 300 KB by default) because this is only
// the browser's side of the bargain; keep IMAGE_TARGET_BYTES comfortably under it.

/** Longest side, in pixels, of an uploaded picture. */
export const IMAGE_MAX_SIDE = 1000;
/** What the shrinking aims for. */
export const IMAGE_TARGET_BYTES = 200 * 1024;
/** The biggest original accepted before shrinking: a guard on browser memory, not on storage. */
export const IMAGE_MAX_INPUT_BYTES = 25 * 1024 * 1024;

// Tried in order until one comes out small enough: quality first, then size. Most photos stop at
// the first step; only very detailed ones go further.
const ATTEMPTS = [
  { side: IMAGE_MAX_SIDE, quality: 0.78 },
  { side: IMAGE_MAX_SIDE, quality: 0.62 },
  { side: 800, quality: 0.6 },
  { side: 640, quality: 0.55 },
  { side: 480, quality: 0.5 },
];

export class ImageDecodeError extends Error {}

/** A smaller copy of `file` as WebP (JPEG where the browser can't write WebP). */
export async function compressImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // Current browsers apply the photo's EXIF orientation here, so phone pictures stay upright.
    bitmap = await createImageBitmap(file);
  } catch {
    // e.g. an iPhone HEIC photo in a browser that can't read HEIC.
    throw new ImageDecodeError("This picture's format can't be read.");
  }

  try {
    let smallest: Blob | null = null;
    for (const attempt of ATTEMPTS) {
      const blob = await encode(bitmap, attempt.side, attempt.quality);
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= IMAGE_TARGET_BYTES) break;
    }
    const type = smallest!.type;
    const base = file.name.replace(/\.[^.]*$/, "") || "image";
    return new File([smallest!], `${base}.${type === "image/webp" ? "webp" : "jpg"}`, { type });
  } finally {
    bitmap.close();
  }
}

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  // White behind transparent pictures: JPEG has no transparency, and a product shot on white
  // reads the same either way.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const webp = await toBlob(canvas, "image/webp", quality);
  // A browser that can't write WebP quietly hands back a PNG instead.
  if (webp.type === "image/webp") return webp;
  return toBlob(canvas, "image/jpeg", quality);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the picture."))), type, quality),
  );
}
