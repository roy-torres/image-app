# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server at http://localhost:5173. The `apiDevServer`
  plugin in `vite.config.js` also serves `/api/generate` here, so the full
  browser → proxy → webhook flow works without `vercel dev`. Needs a `.env`
  (copy `.env.example`).
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built `dist/` (static only; no proxy)

Node 18+ required (20+ preferred); the `apiDevServer` shim relies on global
`fetch` / `Request` / `Response` / `AbortSignal.timeout`.

There is no test suite, linter, or formatter configured. Verify changes against
a running `npm run dev` — the README's "Verifying the proxy" section has curl
checks for every `api/generate.js` response path.

## Architecture

Vite + React 19 + Tailwind CSS v4 SPA **plus one serverless function**, with the
whole app gated behind **Supabase email/password auth**. The browser never calls
the image webhook directly.

```
App.jsx state ─▶ prepareImage() downscales each File ─▶ generateImage()
  POSTs multipart (image1,image2) to /api/generate (same origin)
  ─▶ api/generate.js (Vercel Edge fn) validates + forwards to WEBHOOK_URL
  ─▶ response streamed back ─▶ ResultPanel renders it
```

### Server side

- `api/generate.js` — Vercel **Edge** function (`runtime: 'edge'`). The only
  place the real webhook URL/secret exist, via **server-only** env
  (`WEBHOOK_URL`, `WEBHOOK_SECRET`, `ALLOWED_ORIGINS`, `MAX_FILE_MB`,
  `RATE_LIMIT_*`) — none are `VITE_`-prefixed, so none reach the bundle. It
  enforces: POST-only, origin allow-list, best-effort in-memory per-IP rate
  limit, per-file + total size caps, raster-image-only type check. It **never**
  relays the upstream error body (may contain internal detail) and never echoes
  `WEBHOOK_URL`.
- `vite.config.js` `apiDevServer` — dev-only shim that loads the Edge handler and
  adapts Node req/res ↔ web `Request`/`Response`. Also loads `.env` into
  `process.env` via `loadEnv`. Keep it in sync if `api/generate.js`'s
  request/response contract changes.
- `vercel.json` — strict CSP + security headers for all static responses. The CSP
  is `script-src 'self'` with no inline allowance; `build.modulePreload.polyfill`
  is disabled in `vite.config.js` so the build emits no inline script. `connect-src`
  is `'self'` plus the Supabase project origin
  (`https://yzsxemoppdiefsuevmrz.supabase.co`) so the browser can reach Supabase
  Auth. Adding an inline `<script>`/`<style>` or a new external origin
  (font/CDN/API, or a different Supabase project) means updating the CSP here.

### Auth (Supabase)

- Email/password only, via `@supabase/supabase-js` talking straight to Supabase
  Auth from the browser (no proxy — unlike the image flow). Session is persisted
  by supabase-js in `localStorage` and survives reloads.
- `src/lib/supabaseClient.js` — the one `createClient` instance, built from
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. These **are** `VITE_`-prefixed
  and ship in the bundle **on purpose**: the publishable/anon key only grants
  what RLS allows. This is a different class of value than `WEBHOOK_SECRET`.
  Throws at import time if either var is missing.
- `src/context/AuthContext.jsx` — `AuthProvider` (wraps `<App>` in `main.jsx`) +
  `useAuth()` → `{ loading, session, user, displayName, signUp, signIn, signOut }`.
  `signUp` passes the name as `options.data.full_name`.
- `src/App.jsx` is the gate: `loading` → spinner, no `session` → `<AuthScreen />`,
  else the Studio (header gains `displayName` + a Sign out button). Keep the
  auth early-returns **after** all hook calls.
- `src/components/AuthScreen.jsx` / `AuthForm.jsx` — the signed-out UI; a single
  form toggling sign-in ⇄ create-account.
- **Name storage**: a `public.profiles` row (`id` → `auth.users`, `full_name`,
  `email`, `created_at`), created by the `handle_new_user()` trigger on
  `auth.users` insert. RLS is owner-only select/update; the trigger function has
  `EXECUTE` revoked from `anon`/`authenticated` so it isn't a callable RPC.
  Applied as migrations `create_profiles_table` + `lock_down_handle_new_user`.
- **`api/generate.js` is NOT auth-aware.** The login only gates the UI; the proxy
  still authorizes by Origin + rate limit only. Gating the API would mean sending
  the Supabase access token and verifying it server-side (not done).
- Supabase project: `yzsxemoppdiefsuevmrz`. "Confirm email" is turned **off** in
  the dashboard (Authentication → Providers → Email) for instant login; the
  client still handles the confirmation-required response if it's ever re-enabled.
  Live at `https://image-app-one-mu.vercel.app`.

### Client side

- `src/config.js` — `API_ENDPOINT` (default `/api/generate`) and the downscale
  knobs (`MAX_IMAGE_EDGE`, `IMAGE_QUALITY`, `MAX_UPLOAD_BYTES`). No webhook URL.
- `src/lib/prepareImage.js` — canvas downscale + JPEG re-encode so uploads stay
  under `MAX_UPLOAD_BYTES` (Vercel's ~4.5 MB body cap). Runs at generate time,
  not select time; throws a user-facing message if an image can't be shrunk.
- `src/lib/generateImage.js` — sole client network boundary. Defensive response
  handling: `image/*` → object URL, `application/json` → vetted `{ url }`
  (https/data-image only, via `isSafeImageUrl`) or validated base64, else treat
  blob as image. Returns `{ url, isObjectUrl }`; `isObjectUrl` says whether the
  caller must revoke it. Parses `{ error }` from proxy JSON on non-2xx.
- `src/App.jsx` — state, the generate/reset flow, and **all
  `URL.createObjectURL` lifecycle management**. Every object URL (two previews +
  the result) is revoked on replace, reset, and unmount via `useEffect` cleanups
  keyed to the URL; an `AbortController` ref cancels an in-flight request. Keep
  any new object URL wired into that pattern. **Image-type validation lives
  here** (`isImageFile`, plus an SVG reject), not in `ImageUploader`.
- `src/components/ImageUploader.jsx` — presentational picker; forwards the raw
  `File` upward.
- `src/components/ResultPanel.jsx` — renders only when loading/error/result set;
  Download button appears only after the result `<img>` fires `onLoad`.

## Conventions

- Tailwind utilities only. Palette is the `@theme` block in `src/index.css`
  (`--color-canvas`, `--color-ink`) — use `bg-canvas` / `text-ink`, don't
  reintroduce hex values.
- Plain `.jsx`, no TypeScript. Function components, hooks, no state library.

## Security notes

- The n8n webhook URL was committed in early history (`src/config.js`,
  `.env.example` in the first commits). It should be treated as compromised —
  rotate the webhook path in n8n. Current `.env.example` is a placeholder; the
  real value lives only in git-ignored `.env` / Vercel env.
- `WEBHOOK_SECRET` + n8n Header Auth is the intended second layer; the proxy
  sends `Authorization: Bearer <secret>` whenever the env var is set.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are the **only** `VITE_`-prefixed
  env vars and are meant to be public (RLS-enforced). In Vercel they're marked
  "Config", not "Sensitive". Never give a server-only secret a `VITE_` prefix.
