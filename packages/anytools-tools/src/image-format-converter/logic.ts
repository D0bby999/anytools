export type TargetFormat = 'png' | 'jpeg' | 'webp';

export type ConvertResult = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  sizeBefore: number;
  sizeAfter: number;
};

const MIME_MAP: Record<TargetFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function convertImage(
  file: File | Blob,
  target: TargetFormat,
  quality = 0.9,
): Promise<ConvertResult> {
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 10 MB)`);
  }
  const dataUrl = await blobToDataUrl(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  // JPEG has no alpha: without this a transparent PNG converts onto a black background.
  if (target === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  const mime = MIME_MAP[target];
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error(`Encoder for ${target} not supported in this browser`)),
      mime,
      target === 'png' ? undefined : quality,
    );
  });

  return {
    blob,
    mime,
    width: img.naturalWidth,
    height: img.naturalHeight,
    sizeBefore: file.size,
    sizeAfter: blob.size,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Failed to decode image (unsupported format or corrupt file)'));
    img.src = src;
  });
}
