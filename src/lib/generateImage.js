import { API_ENDPOINT } from '../config.js';

// Only these schemes are safe to drop straight into an <img src> from an
// untrusted JSON response.
function isSafeImageUrl(value) {
  if (typeof value !== 'string') return false;
  return /^https:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(value);
}

/**
 * Sends the two source images to the proxy route and resolves to a displayable
 * image URL: an object URL for a binary response, a data URL for base64 JSON, or
 * a vetted https/data URL when the server returns one.
 *
 * @param {File} file1 - the "Subject" image (e.g. a person)
 * @param {File} file2 - the "Attribute" image (e.g. clothing)
 * @param {AbortSignal} [signal] - optional signal to cancel the request
 * @returns {Promise<{ url: string, isObjectUrl: boolean }>}
 */
export async function generateImage(file1, file2, signal) {
  const formData = new FormData();
  formData.append('image1', file1);
  formData.append('image2', file2);

  let res;
  try {
    res = await fetch(API_ENDPOINT, { method: 'POST', body: formData, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    if (contentType.includes('application/json')) {
      try {
        const body = await res.json();
        if (body?.error) message = String(body.error);
      } catch {
        /* keep the generic message */
      }
    }
    throw new Error(message);
  }

  // Primary path: a binary image (JPEG / WebP / PNG …).
  if (contentType.startsWith('image/')) {
    return { url: URL.createObjectURL(await res.blob()), isObjectUrl: true };
  }

  // n8n workflows sometimes wrap the result in JSON.
  if (contentType.includes('application/json')) {
    const json = await res.json();
    if (isSafeImageUrl(json?.url)) {
      return { url: json.url, isObjectUrl: false };
    }
    const b64 = json?.data || json?.image || json?.b64_json;
    if (typeof b64 === 'string') {
      const clean = b64.replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, '');
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
        return { url: `data:image/png;base64,${clean}`, isObjectUrl: false };
      }
    }
    throw new Error('The server returned an unrecognized response.');
  }

  // Last resort: trust that whatever came back is an image.
  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error('The server returned an empty response.');
  }
  return { url: URL.createObjectURL(blob), isObjectUrl: true };
}
