# Virtual Try-On Studio

A single-page app that takes two images — a **Subject** (person) and an
**Attribute** (clothing/accessory) — and returns a generated composite image.

Built with **Vite + React + Tailwind CSS v4**. The browser never talks to the
image webhook directly: it POSTs to a same-origin serverless proxy
(`api/generate.js`) that holds the real URL and secret server-side.

## Architecture

```
browser  ──POST multipart──▶  /api/generate  ──POST + Bearer secret──▶  n8n webhook
 (React)   (downscaled JPEGs)   (Vercel Edge fn)   (server-only env vars)
```

The proxy enforces: an **origin allow-list**, **per-IP rate limiting**, and
**file type/size limits**, then streams the upstream image back. Uploads are
downscaled to `MAX_IMAGE_EDGE` px and re-encoded as JPEG in the browser
(`src/lib/prepareImage.js`) before they are sent.

## Project structure

```
api/generate.js            Vercel Edge proxy: validate → forward to WEBHOOK_URL → stream back
vercel.json                CSP + security headers for every response
vite.config.js             Vite config + apiDevServer plugin (runs the proxy under `vite dev`)
src/
  config.js                API_ENDPOINT + browser-downscale knobs (no webhook URL)
  App.jsx                   auth gate, all state, generate/reset flow, object-URL lifecycle
  context/
    AuthContext.jsx         AuthProvider + useAuth() (session, signUp/signIn/signOut)
  lib/
    prepareImage.js         canvas downscale + JPEG re-encode before upload
    generateImage.js         POST to /api/generate, defensive response handling
    supabaseClient.js        Supabase browser client singleton
  components/
    ImageUploader.jsx        drag/drop + browse + preview (presentational)
    ResultPanel.jsx          spinner / result image / download button / error
    AuthScreen.jsx           full-page login/signup shell (shown when signed out)
    AuthForm.jsx             email/name/password form, sign in ⇄ create account
    Spinner.jsx
```

## Requirements

Node **18+** (20+ recommended — the dev proxy shim uses global `fetch`,
`Request`/`Response`, and `AbortSignal.timeout`).

## Local development

```bash
npm install
cp .env.example .env      # then fill in WEBHOOK_URL (and WEBHOOK_SECRET if used)
npm run dev               # http://localhost:5173
```

`npm run dev` runs the proxy inside Vite (see the `apiDevServer` plugin in
`vite.config.js`), so the full flow works without the Vercel CLI. `vercel dev`
also works if you prefer to exercise the real function locally.

Flow: pick an image in each card → **Generate** (enabled only once both are set)
→ result renders below with a **Download Image** button. **Reset** clears
everything.

## Production build

```bash
npm run build     # outputs to dist/
npm run preview    # serves the built static app (no proxy — use `vercel dev` for that)
```

## Verifying the proxy

With `npm run dev` running, from the repo root:

```bash
# rejects a missing / wrong Origin
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5173/api/generate   # -> 403

# happy path (needs a valid .env); writes the generated image to out.jpg
curl -s -X POST -H 'Origin: http://localhost:5173' \
  -F 'image1=@subject.png;type=image/png' \
  -F 'image2=@attribute.png;type=image/png' \
  http://localhost:5173/api/generate -o out.jpg -w '%{http_code} %{content_type}\n'
```

Other expected codes: `405` (GET), `400` (missing `image1`/`image2`), `415`
(non-raster / SVG), `413` (too large), `429` (rate limit), `502`/`504`
(upstream error / timeout).

## Environment variables

Set these in **Vercel → Settings → Environment Variables** (and in `.env` for
local dev). The proxy vars below are **not** `VITE_`-prefixed, so none reach the
client bundle. The `VITE_SUPABASE_*` vars in the [Authentication](#authentication-supabase)
section _are_ bundled on purpose.

| Name | Required | Purpose |
| --- | --- | --- |
| `WEBHOOK_URL` | yes | The private n8n webhook the proxy forwards to. |
| `WEBHOOK_SECRET` | no | Sent upstream as `Authorization: Bearer <secret>`. |
| `ALLOWED_ORIGINS` | recommended | Comma-separated origins allowed to call `/api/generate`. Add your production domain(s); `http://localhost:5173` is the default. |
| `MAX_FILE_MB` | no | Per-file upload cap (default `4`). |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | no | Per-IP limit (default `10` per `60000` ms). |

## Authentication (Supabase)

The whole app sits behind a login. Visitors sign up with **name, email, and
password** (Supabase Auth) and sign back in later; the Studio only renders once
there is a session.

- Client: `src/lib/supabaseClient.js` (the singleton), `src/context/AuthContext.jsx`
  (`AuthProvider` + `useAuth()`), `src/components/AuthScreen.jsx` /
  `AuthForm.jsx` (the login/signup UI). `src/App.jsx` gates on the session and
  adds the header **Sign out** button.
- The name is stored in a `public.profiles` row, created automatically by a
  Postgres trigger on signup (migration `create_profiles_table`) and protected
  by row-level security.

| Name | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase project URL, e.g. `https://<ref>.supabase.co`. Bundled into the client. |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase publishable/anon key (`sb_publishable_…`). Bundled into the client — safe, since it only grants what RLS allows. |

Add both to the Vercel project's Environment Variables (all environments) and to
`.env` for local dev. Update the `connect-src` in `vercel.json` if you point the
app at a different Supabase project.

For instant login (no email round-trip), turn **off** Supabase dashboard →
**Authentication → Providers → Email → "Confirm email"**. With it on, signup
sends a confirmation link and the UI asks the user to confirm before signing in.

## Deploy to Vercel

1. Push this repo to Git and import it in Vercel — the **Vite** preset is
   auto-detected (build `npm run build`, output `dist`), and `api/` is picked up
   as serverless functions automatically.
2. Add the environment variables above.
3. Set `ALLOWED_ORIGINS` to include the deployed domain, e.g.
   `https://your-app.vercel.app,http://localhost:5173`.

`vercel.json` adds a strict Content-Security-Policy and related security headers
to every response.

## Hardening the n8n webhook (recommended)

The proxy hides the URL from browsers, but treat the webhook URL as a secret and
lock the endpoint down too:

- On the n8n **Webhook** node set **Authentication → Header Auth**, create a
  credential (e.g. header `Authorization`, value `Bearer <random-string>`), and
  put the same value in `WEBHOOK_SECRET`.
- Restrict the node's allowed origins / add a rate limit if your plan supports
  it.
- **Rotate the webhook path** if the current URL was ever committed or shared —
  regenerating the webhook ID in n8n is the only way to invalidate a leaked URL.
  (This URL appeared in early git history of this repo.)

## Notes

- The proxy's rate limiter is in-memory and best-effort (Edge instances are
  ephemeral). For durable limits, back it with Vercel KV / Upstash.
- Vercel caps a function request body at ~4.5 MB; browser-side downscaling keeps
  requests well under that.
