/**
 * Client-side image compression for KYC uploads.
 *
 * Uploads are capped at 8MB and are now compressed on-device before they
 * leave the browser, so a 12MP phone photo (typically 3–6MB as HEIC/PNG
 * and well over the limit as an uncompressed scan) arrives as a bounded,
 * review-ready JPEG instead of being rejected at the boundary. PDFs are
 * returned untouched — canvas has no way to re-encode them.
 */

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image — the file may be corrupt.'));
    img.src = source;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Returns a JPEG-compressed File. Non-image files (PDFs) and images already
 * small enough to re-encode without benefit are returned unchanged.
 */
export async function compressImageFile(
  file: File,
  opts?: { maxDim?: number; quality?: number },
): Promise<File> {
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file;

  const maxDim = opts?.maxDim ?? MAX_DIMENSION;
  const quality = opts?.quality ?? JPEG_QUALITY;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);

    // Below the re-encode threshold, keep the original bytes — re-encoding
    // a small PNG to JPEG buys nothing and adds a lossy generation.
    if (img.width <= maxDim && img.height <= maxDim && file.size <= 1024 * 1024) return file;

    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // JPEG has no alpha channel — flatten transparent PNGs onto white so
    // scans (which are frequently padded PNGs) stay readable.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;

    // Compression failed to shrink the file (or the browser produced an
    // unexpectedly large encode) — prefer the original over a bigger upload.
    if (blob.size >= file.size) return file;

    return new File([blob], file.name, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
