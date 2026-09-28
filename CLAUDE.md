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

Vite + React 19 + Tailwind CSS v4 SPA **plus one Vercel serverless function and
one Supabase Edge Function**. The app is gated in two stages: **Supabase
email/password auth**, then an active **$9.99/month Stripe subscription**
(Payment Link → subscription webhooks → `profiles.is_paid`). The browser never
calls the image webhook directly.

```
App.jsx state ─▶ prepareImage() downscales each File ─▶ generateImage()
  POSTs multipart (image1,image2) to /api/generate (same origin)
  ─▶ api/generate.js (Vercel Edge fn) validates + forwards to WEBHOOK_URL
  ─▶ response streamed back ─▶ ResultPanel renders it
```

Each of the two image slots (Subject, Attribute) is filled either by a manual
upload or by one click on a built-in thumbnail (`src/catalog.js` via
`PresetPicker`); a preset pick is `fetch`ed into a `File` (`src/lib/urlToFile.js`)
so everything downstream is identical either way.

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
  The Stripe Payment Link needs **no** CSP change — it's a top-level navigation
  to `buy.stripe.com`, not a frame, fetch, or form post.

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

### Payments (Stripe)

**$9.99/month** recurring, via a hosted **Stripe Payment Link** in subscription
mode (no Stripe.js, no embedded checkout — a full-page redirect out and back).
Currently **test mode** on Stripe account `acct_1UChm5GXWHoQEMoh` ("UX+AI");
going live means re-creating the product/price/link/webhook with live keys.

- **Gate order** (`src/App.jsx`, early returns after all hooks): `loading` →
  spinner, no `session` → `<AuthScreen />`, `session` but `isPaid === null`
  (entitlement not read yet) → spinner, `!isPaid` → `<Paywall />`, else the
  Studio. So a member-less user is signed in but sees only the paywall.
- `src/components/Paywall.jsx` — the subscribe screen. Opens
  `STRIPE_PAYMENT_LINK` with `?client_reference_id=<supabase user id>&prefilled_email=<email>`
  appended so the webhook can link the Stripe customer to the account. Polls
  `refreshEntitlement({ silent: true })` every 4 s and on return from Stripe
  (`?paid=1`, which it strips), so the gate flips on its own once the
  subscription is active.
- `src/context/AuthContext.jsx` — `useAuth()` gains
  `{ isPaid, entitlementLoading, refreshEntitlement }`. `isPaid` is `null` until
  `profiles.is_paid` is read for the current user, then boolean. Re-read when the
  user id changes **and** re-validated for an open session — every 60 s and on
  tab focus/visibility — so a lapsed subscription drops the user to the paywall
  mid-session without a reload. `refreshEntitlement(opts)` forwards
  `{ silent }` (skip the loading flag for background checks).
- **Membership state** on `public.profiles`:
  - `add_payment_fields_to_profiles` — `is_paid boolean not null default false`,
    `paid_at`, `stripe_customer_id`, `stripe_checkout_session_id`; **plus**
    `revoke update on public.profiles from anon, authenticated` +
    `grant update (full_name) …` so a signed-in user can edit only their display
    name — every payment column is writable **only** by the service role.
  - `switch_profiles_to_subscription` — adds `stripe_subscription_id`,
    `subscription_status` (raw Stripe status), `current_period_end`. New columns
    inherit no `UPDATE` grant, so they stay service-role-only too.
  - `profiles_select_own` RLS still lets a user read their own row (incl.
    `is_paid`). `is_paid` now means "has an active/trialing subscription".
- `supabase/functions/stripe-webhook/index.ts` — Supabase Edge Function,
  deployed with **`verify_jwt = false`** (Stripe can't send a Supabase JWT). It
  verifies the Stripe signature itself (HMAC-SHA256, Web Crypto, no SDK — same
  posture as `api/generate.js`), then:
  - `checkout.session.completed` (mode `subscription`) — the **only** event with
    `client_reference_id`; PATCH `profiles WHERE id = client_reference_id` to set
    `is_paid = true`, `stripe_customer_id`, `stripe_subscription_id`. This is
    where the Stripe customer gets linked to the user.
  - `customer.subscription.created / updated / deleted` — no user id on these, so
    PATCH `profiles WHERE stripe_customer_id = <customer>`; `is_paid =
    status ∈ {active, trialing}` (deleted ⇒ false). Idempotent; a 5xx makes
    Stripe retry.
  - Endpoint: `https://yzsxemoppdiefsuevmrz.supabase.co/functions/v1/stripe-webhook`.
- **The one manual secret**: `STRIPE_WEBHOOK_SIGNING_SECRET` (`whsec_…` from the
  Stripe webhook endpoint — unchanged across the endpoint's `enabled_events`
  edits) is set as a Supabase Edge Function secret in the dashboard (no MCP tool,
  no Supabase CLI installed). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are
  auto-injected.
- **Self-service cancel**: `STRIPE_BILLING_PORTAL_URL` (Stripe Customer Portal
  login link — set up in the Stripe Dashboard, static public URL) drives the
  header **Manage billing** link in the Studio; hidden when unset, and hidden
  when the user has no `stripe_customer_id` (`useAuth().hasBillingAccount` —
  e.g. the shared demo account, whose membership was granted in the DB). Cancels /
  failed payments come back as `customer.subscription.updated/deleted` and
  revoke `is_paid`. A nicer direct-portal flow (server-created portal session)
  would need `STRIPE_SECRET_KEY` + another Edge Function — not done; the MCP key
  also lacks `billing_portal` write permission.
- **`api/generate.js` is still NOT payment-aware** (nor auth-aware) — same
  posture as the login: the paywall gates the UI only. Server-side enforcement
  would mean sending the Supabase access token to the proxy and verifying it.
- Stripe: webhook `we_1UCjKCGXWHoQEMohzdLMwWo7`
  (`checkout.session.completed`, `customer.subscription.{created,updated,deleted}`),
  product `prod_VD9bgvgaFJH7xW`, recurring price `price_1UCjTLGXWHoQEMohhkW9CGQo`
  ($9.99/mo), payment link `plink_1UCjToGXWHoQEMohX3YSwkW3`
  (`https://buy.stripe.com/test_9B66oH0Lxeil36Tdx46sw01`). The old one-time
  price/link (`…FRDIxS15` / `…f1kwRmV7`) are deactivated.

### Client side

- `src/config.js` — `API_ENDPOINT` (default `/api/generate`), the downscale
  knobs (`MAX_IMAGE_EDGE`, `IMAGE_QUALITY`, `MAX_UPLOAD_BYTES`),
  `STRIPE_PAYMENT_LINK` (from `VITE_STRIPE_PAYMENT_LINK`) and
  `STRIPE_BILLING_PORTAL_URL` (from `VITE_STRIPE_BILLING_PORTAL_URL`, optional).
  No webhook URL, no Stripe secret.
- `src/catalog.js` — `MODELS` + `WARDROBE`: built-in sample subjects and
  clothing, each a bundled (Vite-fingerprinted) asset under `src/assets/`. Add a
  piece by dropping the file in and adding one line here.
- `src/components/PresetPicker.jsx` — the thumbnail strip under each
  `ImageUploader`. Clicking a thumb calls `onPick(item)`; `App.jsx`'s
  `makePresetHandler` runs `urlToFile(item.src)` and drops the resulting `File`
  into that slot exactly like a manual upload (same prepareImage → generateImage
  path). Slot state gains `presetId` so the active thumb is highlighted; a manual
  upload or clear resets it to `null`.
- `src/lib/urlToFile.js` — `fetch()` a same-origin bundled asset → `File`.
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
  any new object URL wired into that pattern. A preset pick
  (`makePresetHandler`) creates its preview object URL the same way a manual
  upload does, and each slot carries a `presetId` (`null` after a manual upload
  or clear) so `PresetPicker` can highlight the active thumb. **Image-type
  validation lives here** (`isImageFile`, plus an SVG reject), not in
  `ImageUploader`.
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
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_STRIPE_PAYMENT_LINK` /
  `VITE_STRIPE_BILLING_PORTAL_URL` are the **only** `VITE_`-prefixed env vars and
  are all meant to be public (the first two RLS-enforced; the Stripe URLs are the
  same links every subscriber opens). In Vercel mark them "Config", not
  "Sensitive". Never give a server-only secret a `VITE_` prefix — the Stripe
  **secret key** is never used client-side, and the webhook **signing secret**
  lives only as a Supabase Edge Function secret.
