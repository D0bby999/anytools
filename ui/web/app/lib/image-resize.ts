/**
 * image-resize.ts
 * A photo is prepared in the browser before it is uploaded (up-methods
 * phase 16).
 *
 * A phone photo is 4000 px or more on its long side, and the model that reads
 * it bills by the pixel, so a large one is scaled to MAX_PHOTO_SIDE and
 * re-encoded as JPEG at PHOTO_QUALITY. A canvas encodes pixels only, so the
 * re-encode also drops the EXIF block, and with it the place the photo was
 * taken. Camera formats (JPEG, HEIC) are re-encoded even when they are small
 * enough, because that is where the location lives; a PNG or WebP of a
 * reasonable size is sent as it is.
 *
 * A photo the browser cannot decode (HEIC outside Safari) is sent as it is,
 * and the server reads it as HEIC.
 */
import { isPhotoFile } from "./kb-types";

/** The long side a photo is scaled to. */
export const MAX_PHOTO_SIDE = 3000;
/** The JPEG quality of a re-encoded photo. */
export const PHOTO_QUALITY = 0.9;

/** A decoded photo, oriented as it is meant to be seen. */
export type DecodedPhoto = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close?: () => void;
};

/** The two browser steps, replaceable in tests (jsdom has no canvas). */
export type PhotoCodec = {
  decode(file: Blob): Promise<DecodedPhoto | null>;
  encode(photo: DecodedPhoto, width: number, height: number, quality: number): Promise<Blob>;
};

/** The size a photo is drawn at: its own, or scaled so the long side is `max`. */
export function scaledSize(width: number, height: number, max = MAX_PHOTO_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function isCameraFormat(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "image/jpeg" ||
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(jpe?g|heic)$/.test(name)
  );
}

function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name) + ".jpg";
}

/**
 * The file to upload for `file`: scaled and re-encoded when it is large or a
 * camera format, otherwise the file itself.
 */
export async function preparePhoto(file: File, codec: PhotoCodec = browserCodec): Promise<File> {
  if (!isPhotoFile(file)) return file;
  const decoded = await codec.decode(file);
  if (!decoded) return file;
  try {
    const tooLarge = Math.max(decoded.width, decoded.height) > MAX_PHOTO_SIDE;
    if (!tooLarge && !isCameraFormat(file)) return file;
    const size = scaledSize(decoded.width, decoded.height);
    const blob = await codec.encode(decoded, size.width, size.height, PHOTO_QUALITY);
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    // An encoder that fails leaves the photo as it was: the server still
    // reads it, it only costs more to.
    return file;
  } finally {
    decoded.close?.();
  }
}

/** The browser's own decoder and canvas. */
export const browserCodec: PhotoCodec = {
  async decode(file) {
    if (typeof createImageBitmap !== "function") return null;
    try {
      // "from-image" applies the EXIF orientation to the pixels, so dropping
      // the EXIF block does not turn a portrait photo on its side.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
    } catch {
      return null;
    }
  },
  async encode(photo, width, height, quality) {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(photo.source, 0, 0, width, height);
      return canvas.convertToBlob({ type: "image/jpeg", quality });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(photo.source, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/jpeg", quality),
    );
  },
};
