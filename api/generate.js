// Serverless proxy between the browser and the private n8n webhook.
//
// The browser only ever talks to this same-origin route, so the real webhook
// URL and its auth secret never reach the client bundle. This function also
// enforces an origin allow-list, per-IP rate limiting, and upload size/type
// limits before forwarding the request upstream.
//
// Required env (set in Vercel project settings, NOT prefixed with VITE_):
//   WEBHOOK_URL       - the n8n webhook endpoint
// Optional env:
//   WEBHOOK_SECRET    - sent upstream as `Authorization: Bearer <secret>`
//   ALLOWED_ORIGINS   - comma-separated origin allow-list
//                       (defaults to http://localhost:5173 for local dev)
//   MAX_FILE_MB       - per-file cap (default 4)
//   RATE_LIMIT_MAX    - requests per window per IP (default 10)
//   RATE_LIMIT_WINDOW_MS - window length (default 60000)

export const config = { runtime: 'edge' };

const DEFAULT_ALLOWED = ['http://localhost:5173'];
const UPSTREAM_TIMEOUT_MS = 90_000;

// Best-effort in-memory limiter. Edge instances are ephemeral and not shared,
// so this slows abuse but is not a hard guarantee — move to Vercel KV / Upstash
// if you need durable limits.
const hits = new Map();

function rateLimit(ip, max, windowMs) {
  const now = Date.now();

  // Opportunistic sweep so the Map can't grow without bound.
  if (hits.size > 5000) {
    for (const [key, val] of hits) {
      if (now - val.start >= windowMs) hits.delete(key);
    }
  }

  const rec = hits.get(ip);
  if (!rec || now - rec.start >= windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return { ok: true };
  }
  rec.count += 1;
  if (rec.count > max) {
    return { ok: false, retryAfter: Math.ceil((rec.start + windowMs - now) / 1000) };
  }
  return { ok: true };
}

function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' }, { allow: 'POST' });
  }

  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowList = allowed.length ? allowed : DEFAULT_ALLOWED;

  const origin = request.headers.get('origin');
  // Browsers always send Origin on cross-origin POSTs and on same-origin POSTs
  // with FormData. Reject anything not on the list; reject missing Origin too
  // (non-browser clients) unless it's a same-origin request we can verify.
  if (!origin || !allowList.includes(origin)) {
    return json(403, { error: 'Origin not allowed.' });
  }

  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    return json(500, { error: 'Server is not configured.' });
  }

  const ip =
    request.headers.get('x-real-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown';
  const rlMax = Number(process.env.RATE_LIMIT_MAX || 10);
  const rlWindow = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const rl = rateLimit(ip, rlMax, rlWindow);
  if (!rl.ok) {
    return json(429, { error: 'Too many requests. Slow down.' }, {
      'retry-after': String(rl.retryAfter),
    });
  }

  const maxFileBytes = Math.round(Number(process.env.MAX_FILE_MB || 4) * 1024 * 1024);
  const maxTotalBytes = Math.round(4.5 * 1024 * 1024); // Vercel request-body ceiling

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'Expected multipart/form-data.' });
  }

  const image1 = form.get('image1');
  const image2 = form.get('image2');

  for (const [name, file] of [
    ['image1', image1],
    ['image2', image2],
  ]) {
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return json(400, { error: `Missing file field: ${name}.` });
    }
    const type = (file.type || '').toLowerCase();
    if (!type.startsWith('image/') || type === 'image/svg+xml') {
      return json(415, { error: `${name} must be a raster image (PNG, JPEG, WebP).` });
    }
    if (file.size <= 0 || file.size > maxFileBytes) {
      return json(413, {
        error: `${name} must be between 1 byte and ${process.env.MAX_FILE_MB || 4} MB.`,
      });
    }
  }

  if (image1.size + image2.size > maxTotalBytes) {
    return json(413, { error: 'Combined upload is too large. Use smaller images.' });
  }

  const upstreamForm = new FormData();
  upstreamForm.append('image1', image1, image1.name || 'image1');
  upstreamForm.append('image2', image2, image2.name || 'image2');

  const headers = {};
  if (process.env.WEBHOOK_SECRET) {
    headers.authorization = `Bearer ${process.env.WEBHOOK_SECRET}`;
  }

  let upstream;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      body: upstreamForm,
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return json(timedOut ? 504 : 502, {
      error: timedOut ? 'The image service timed out.' : 'The image service is unavailable.',
    });
  }

  if (!upstream.ok) {
    // Do not relay the upstream body — it may contain internal detail.
    return json(502, {
      error: `The image service returned an error (${upstream.status}).`,
    });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
