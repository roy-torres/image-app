// Same-origin proxy route (api/generate.js) that forwards to the private n8n
// webhook. The real webhook URL lives only in server-side env vars and is never
// shipped to the browser. Override only if the API is hosted elsewhere.
export const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT ?? '/api/generate';

// Longest edge (px) and JPEG quality used to downscale uploads in the browser
// before sending. Keeps requests under the serverless body limit and speeds
// things up; raise MAX_IMAGE_EDGE if you need more detail upstream.
export const MAX_IMAGE_EDGE = 1600;
export const IMAGE_QUALITY = 0.82;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // must stay <= api/generate.js cap
