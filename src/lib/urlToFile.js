/**
 * Fetches a same-origin (bundled) asset and wraps it in a `File` so it can flow
 * through the same prepareImage → generateImage path as a manual upload.
 *
 * @param {string} url   same-origin asset URL (from src/catalog.js)
 * @param {string} name  file name to give the result
 * @returns {Promise<File>}
 */
export async function urlToFile(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load that image. Try another one.');
  const blob = await res.blob();
  const type = blob.type || 'image/jpeg';
  return new File([blob], name, { type, lastModified: Date.now() });
}
