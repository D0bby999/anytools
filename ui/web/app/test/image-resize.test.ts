import { describe, expect, it } from "vitest";
import { MAX_PHOTO_SIDE, PHOTO_QUALITY, preparePhoto, scaledSize, type PhotoCodec } from "~/lib/image-resize";

// A 16×12 JPEG whose EXIF block names a camera maker and a GPS position
// (10°46'30"N 106°41'E), written with Pillow for this test.
const GPS_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4QCsRXhpZgAATU0AKgAAAAgAAwEPAAIAAAALAAAAMgESAAMAAAABAAEAAIglAAQAAAABAAAAPgAAAABQaG9uZU1ha2VyAAAABAABAAIAAAACTgAAAAACAAUAAAADAAAAdAADAAIAAAACRQAAAAAEAAUAAAADAAAAjAAAAAAAAAAKAAAAAQAAAC4AAAABAAAAHgAAAAEAAABqAAAAAQAAACkAAAABAAAAAAAAAAH/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0uiiiuA7j/9k=";

function bytesOf(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function bytesOfBlob(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Whether a JPEG carries an EXIF block with a GPS pointer (tag 0x8825). */
function hasGPS(data: Uint8Array): boolean {
  for (let i = 2; i + 4 < data.length; ) {
    if (data[i] !== 0xff) return false;
    const marker = data[i + 1]!;
    const len = (data[i + 2]! << 8) | data[i + 3]!;
    if (marker === 0xe1) {
      const seg = data.subarray(i + 4, i + 2 + len);
      const isExif = String.fromCharCode(...seg.subarray(0, 4)) === "Exif";
      for (let j = 0; isExif && j + 1 < seg.length; j++) {
        if (seg[j] === 0x88 && seg[j + 1] === 0x25) return true;
      }
    }
    if (marker === 0xda) return false;
    i += 2 + len;
  }
  return false;
}

/** The canvas stand-in: decodes to the given size and encodes a bare JPEG, recording what it drew. */
function fakeCodec(size: { width: number; height: number } | null) {
  const drawn: { width: number; height: number; quality: number }[] = [];
  const codec: PhotoCodec = {
    async decode() {
      return size ? { ...size, source: {} as CanvasImageSource } : null;
    },
    async encode(_photo, width, height, quality) {
      drawn.push({ width, height, quality });
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])], { type: "image/jpeg" });
    },
  };
  return { codec, drawn };
}

describe("preparePhoto", () => {
  it("knows the fixture carries a location", () => {
    expect(hasGPS(bytesOf(GPS_JPEG))).toBe(true);
  });

  it("caps the long side at 3000 px and drops the location", async () => {
    const file = new File([bytesOf(GPS_JPEG)], "IMG_2041.HEIC", { type: "image/heic" });
    const { codec, drawn } = fakeCodec({ width: 4032, height: 3024 });
    const out = await preparePhoto(file, codec);
    expect(drawn).toEqual([{ width: MAX_PHOTO_SIDE, height: 2250, quality: PHOTO_QUALITY }]);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_2041.jpg");
    expect(hasGPS(await bytesOfBlob(out))).toBe(false);
  });

  it("re-encodes a small camera photo too, because that is where the location is", async () => {
    const file = new File([bytesOf(GPS_JPEG)], "page.jpg", { type: "image/jpeg" });
    const { codec, drawn } = fakeCodec({ width: 16, height: 12 });
    const out = await preparePhoto(file, codec);
    expect(drawn).toEqual([{ width: 16, height: 12, quality: PHOTO_QUALITY }]);
    expect(out).not.toBe(file);
    expect(hasGPS(await bytesOfBlob(out))).toBe(false);
  });

  it("sends a PNG of a reasonable size as it is, and scales a large one", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "scan.png", { type: "image/png" });
    expect(await preparePhoto(png, fakeCodec({ width: 1200, height: 1600 }).codec)).toBe(png);
    const { codec, drawn } = fakeCodec({ width: 2000, height: 6000 });
    const out = await preparePhoto(png, codec);
    expect(drawn).toEqual([{ width: 1000, height: 3000, quality: PHOTO_QUALITY }]);
    expect(out.name).toBe("scan.jpg");
  });

  it("sends what the browser cannot decode, and anything that is not a photo, untouched", async () => {
    const heic = new File([new Uint8Array([0, 0, 0, 0x18])], "IMG_1.heic", { type: "image/heic" });
    expect(await preparePhoto(heic, fakeCodec(null).codec)).toBe(heic);
    const pdf = new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" });
    expect(await preparePhoto(pdf, fakeCodec({ width: 9000, height: 9000 }).codec)).toBe(pdf);
  });

  it("scales by the long side and keeps the shape", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 3000, height: 2250 });
    expect(scaledSize(3000, 3000)).toEqual({ width: 3000, height: 3000 });
    expect(scaledSize(1, 9000)).toEqual({ width: 1, height: 3000 });
  });
});
