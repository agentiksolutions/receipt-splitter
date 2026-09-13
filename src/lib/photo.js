// Phone photos run 4 to 12 MB. The reader caps its base64 payload at 6 MB, so
// everything goes through here first: one downscale, and the same JPEG is what
// gets uploaded and what gets read.

import jsQR from 'jsqr';
import { supabase } from '../supabaseClient';

// A week. Long enough that a split stays readable for as long as anyone is
// still settling it, short enough that a leaked link goes stale.
const SIGNED_FOR = 60 * 60 * 24 * 7;

/**
 * Turn whatever is in rs_receipts.photo_url into something an <img> can load.
 * New rows hold a storage PATH and get a signed URL, so the bucket can be
 * private. A row holding an http URL predates that and is used as it stands.
 */
export async function photoSrc(value) {
  const v = (value || '').trim();
  if (!v) return null;
  if (/^(https?:|blob:|data:)/i.test(v)) return v;
  const { data } = await supabase.storage.from('receipt-photos').createSignedUrl(v, SIGNED_FOR);
  return data?.signedUrl || null;
}

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

/**
 * Read a QR code out of a photo of somebody's screen or printed code.
 * @param {File} file
 * @returns {Promise<?string>} the decoded text, or null when there is no code
 */
export async function decodeQr(file) {
  const source = await decode(file);
  const w = source.width;
  const h = source.height;
  // A phone photo is far bigger than jsQR needs and the scan is O(pixels).
  const scale = Math.min(1, 1000 / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close();

  const data = ctx.getImageData(0, 0, width, height);
  const found = jsQR(data.data, width, height, { inversionAttempts: 'attemptBoth' });
  return found?.data || null;
}
