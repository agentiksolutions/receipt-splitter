// Phone photos run 4 to 12 MB. The reader caps its base64 payload at 6 MB, so
// everything goes through here first: one downscale, and the same JPEG is what
// gets uploaded and what gets read.

export const MAX_EDGE = 1600;
export const QUALITY = 0.85;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // from-image applies the EXIF rotation, so a photo taken sideways is not read sideways.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Safari before 17 has no options bag. Fall through. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file is not an image this browser can open.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the photo.'))),
      'image/jpeg',
      QUALITY
    );
  });
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // The reader wants raw base64, so drop the "data:image/jpeg;base64," prefix.
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('The browser could not read the photo.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {File} file
 * @returns {Promise<{blob: Blob, base64: string, previewUrl: string, width: number, height: number}>}
 */
export async function prepare(file) {
  const source = await decode(file);
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close();

  const blob = await toBlob(canvas);
  const base64 = await toBase64(blob);
  return { blob, base64, previewUrl: URL.createObjectURL(blob), width, height };
}
