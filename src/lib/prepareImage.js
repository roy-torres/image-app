import { IMAGE_QUALITY, MAX_IMAGE_EDGE, MAX_UPLOAD_BYTES } from '../config.js';

const bytesToMB = (n) => (n / 1024 / 1024).toFixed(1);

/**
 * Downscales/re-encodes an image in the browser so the upload stays well under
 * the serverless request-body limit. Returns a new JPEG `File`, or the original
 * file when it is already small and within bounds.
 *
 * Throws if the image cannot be brought under `MAX_UPLOAD_BYTES`.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable here (rare). Let it through only if it already fits; the
    // server still validates type and size.
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw new Error(
      `"${file.name}" is ${bytesToMB(file.size)} MB and can't be resized in the browser. Export a smaller image (under ${bytesToMB(MAX_UPLOAD_BYTES)} MB).`,
    );
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
  const alreadySmall = scale === 1 && file.size <= MAX_UPLOAD_BYTES && file.size <= 1_500_000;

  if (alreadySmall) {
    bitmap.close?.();
    return file;
  }

  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // White matte so PNG transparency doesn't turn black in the JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let quality = IMAGE_QUALITY;
  let blob = await canvasToBlob(canvas, quality);

  // Step the quality down if a very noisy image is still over budget.
  while (blob && blob.size > MAX_UPLOAD_BYTES && quality > 0.4) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, quality);
  }

  if (!blob || blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is too large to send even after compression. Try a smaller image.`,
    );
  }

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
