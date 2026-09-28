# Virtual Try-On Studio v2

A single-page app that takes two images — a **Subject** (person) and an
**Attribute** (clothing/accessory) — and returns a generated composite image.
Each slot can be a manual upload or a one-click pick from the built-in models /
wardrobe (`src/catalog.js`, shown by `PresetPicker`).

Built with **Vite + React + Tailwind CSS v4**. The browser never talks to the
image webhook directly: it POSTs to a same-origin serverless proxy
(`api/generate.js`) that holds the real URL and secret server-side. Access is
gated in two stages — **Supabase email/password auth**
([Authentication](#authentication-supabase)) then an active **$9.99/month
membership** ([Payments](#payments-stripe)).

## Live demo

**<https://image-app-one-mu.vercel.app/>**

**Fastest (about 10 seconds):** sign in with the shared demo account. It already
has an active membership, so it goes straight to the Studio.

- Email: `demo@tryon-studio.app`
- Password: `TryOnDemo2026`

Click a built-in model and a clothing item, then **Generate**.

**Want to see the full sign-up and checkout flow?** Click **Sign up**
and use any email (no confirmation email is sent) and a password of 6+
characters. On the $9.99/month screen, pay with test card
`4242 4242 4242 4242`, any future expiry and any CVC/ZIP. **No real payment is
taken**, because Stripe is in test mode. When you're sent back to the app, it
unlocks within a few seconds.

## Design decisions

The rest of this README is implementation. This section is the product
reasoning behind it.

- **Two labeled slots instead of a prompt.** The task is expressed as a
  *Subject* (person) and an *Attribute* (garment) rather than free text, so the
  user never has to describe an outcome in words — and the app never has to
  interpret an ambiguous one.
- **A starter catalog, to remove the blank canvas.** An empty first screen is
  where generative tools lose people. One click on a built-in model or wardrobe
  thumbnail fills a slot; the pick is fetched into a `File`
  (`src/lib/urlToFile.js`) so it travels the identical path as a manual upload —
  one code path, no divergent behavior. (`src/components/PresetPicker.jsx`)
- **Downscale in the browser, at generate time.** Uploads are resized and
  re-encoded to JPEG before they are sent (`src/lib/prepareImage.js`), which
  keeps the request under the serverless body limit and shortens the wait on a
  phone. It runs on generate rather than on select, so choosing an image stays
  instant.
- **Plain-language errors, never upstream detail.** The proxy does not relay the
  upstream error body (`api/generate.js`), so the UI shows a sentence the user
  can act on instead of a status code — and internal detail cannot leak through
  a failure.
- **Download appears only once the image has rendered.** `ResultPanel` waits for
  the result `<img>` to fire `onLoad` before offering the button, so it is never
  a broken promise.
- **A gate that resolves itself.** A signed-in user without a membership sees
  the paywall, which re-checks entitlement every 4s and on return from Stripe
  (`src/components/Paywall.jsx`) — unlocking never asks the user to reload. A
  lapsed subscription re-gates mid-session by the same mechanism
  (`src/context/AuthContext.jsx`).

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
  catalog.js               MODELS + WARDROBE — built-in sample subjects / clothing
  assets/                  bundled model + wardrobe images (Vite-fingerprinted)
  App.jsx                   auth gate, all state, generate/reset flow, object-URL lifecycle
  context/
    AuthContext.jsx         AuthProvider + useAuth() (session, signUp/signIn/signOut)
  lib/
    prepareImage.js         canvas downscale + JPEG re-encode before upload
    urlToFile.js            fetch a bundled catalog asset → File
    generateImage.js         POST to /api/generate, defensive response handling
    supabaseClient.js        Supabase browser client singleton
  components/
    ImageUploader.jsx        drag/drop + browse + preview (presentational)
    PresetPicker.jsx         thumbnail strip of built-in models / wardrobe
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
`.env` for local dev. Vercel flags `VITE_`-prefixed vars as browser-exposed —
that's expected here, so mark each one **"Config"** (not "Sensitive") and keep
the prefix (Vite only exposes `VITE_*` to the client). Env-var changes need a
**redeploy** to take effect. Update the `connect-src` in `vercel.json` if you
point the app at a different Supabase project.

For instant login (no email round-trip), turn **off** Supabase dashboard →
**Authentication → Providers → Email → "Confirm email"**. With it on, signup
sends a confirmation link and the UI asks the user to confirm before signing in.
This is a project-wide setting, so it applies to local and production alike. On
the free tier the built-in email sender caps confirmation emails at ~2/hour.

Current deployment: **https://image-app-one-mu.vercel.app** (Supabase project
`yzsxemoppdiefsuevmrz`, "Confirm email" off). Per-deployment preview URLs sit
behind Vercel's login wall; use the project's production domain.

## Payments (Stripe)

After signing up, a user is signed in but sees a **paywall**
(`src/components/Paywall.jsx`) instead of the Studio until they have an active
**$9.99/month** membership. It's a real subscription — if it lapses (cancel,
failed payment) the user drops back to the paywall.

Flow:

1. The paywall opens a hosted **Stripe Payment Link** (subscription mode) with
   `?client_reference_id=<supabase user id>&prefilled_email=<email>` appended.
2. The user subscribes on Stripe's page; Stripe redirects back with `?paid=1`.
3. Stripe sends `checkout.session.completed` to the **`stripe-webhook` Supabase
   Edge Function**, which verifies the signature and sets `profiles.is_paid = true`
   (plus `stripe_customer_id`, `stripe_subscription_id`, …) for that user via the
   service role. This is the only event that carries the Supabase user id, so
   it's where the Stripe customer gets linked to the account.
4. Later `customer.subscription.created / updated / deleted` events (matched by
   `stripe_customer_id`) keep `profiles.is_paid` in sync — `true` only while the
   status is `active` or `trialing`.
5. The app re-reads `profiles.is_paid` on the paywall (every 4 s + on `?paid=1`)
   and, for an already-open session, every 60 s and on tab focus — so access is
   granted and revoked without a reload.

**Self-service cancel**: the Studio header has a **Manage billing** link to the
Stripe Customer Portal (`VITE_STRIPE_BILLING_PORTAL_URL`). It's hidden until you
set that up — Stripe Dashboard → **Settings → Billing → Customer portal**:
activate it, enable the **login link**, and paste that URL into the env var.
Cancellations there fire `customer.subscription.deleted` and revoke access.

Membership state lives on `public.profiles` (migrations
`add_payment_fields_to_profiles` + `switch_profiles_to_subscription`). Those
migrations also restrict `UPDATE` on the table so a signed-in user can only
change their own `full_name` — every payment column is writable **only** by the
service role (the webhook).

| Name | Where | Purpose |
| --- | --- | --- |
| `VITE_STRIPE_PAYMENT_LINK` | Vercel + `.env` (client, public) | The hosted subscription Payment Link URL. Not a secret. |
| `VITE_STRIPE_BILLING_PORTAL_URL` | Vercel + `.env` (client, public, optional) | Stripe Customer Portal login link for "Manage billing". |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | **Supabase Edge Function secret** | `whsec_…` from the Stripe webhook endpoint. Verifies incoming webhooks. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | auto-injected into the Edge Function | Lets the webhook write `profiles`. |

Currently everything is **Stripe test mode** (account "UX+AI"). Subscribe with
card `4242 4242 4242 4242`, any future expiry, any CVC/ZIP. **To go live**:
activate live mode on the Stripe account, re-create the product / $9.99-monthly
price / Payment Link / webhook endpoint with live keys, set the live
`STRIPE_WEBHOOK_SIGNING_SECRET` on Supabase, and point `VITE_STRIPE_PAYMENT_LINK`
(and the portal URL) at the live links in Vercel (then redeploy).

The Stripe webhook is a **Supabase Edge Function**, deployed with
`verify_jwt = false` (Stripe can't send a Supabase JWT — it authenticates via the
Stripe signature). Redeploy it with the Supabase CLI
(`supabase functions deploy stripe-webhook --no-verify-jwt`) or the MCP
`deploy_edge_function` tool. `api/generate.js` is **not** payment-aware — the
paywall gates the UI only, same as the login.

## Deploy to Vercel

1. Push this repo to Git and import it in Vercel — the **Vite** preset is
   auto-detected (build `npm run build`, output `dist`), and `api/` is picked up
   as serverless functions automatically.
2. Add the environment variables above, including `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` and `VITE_STRIPE_PAYMENT_LINK`, then redeploy. The
   Stripe webhook's `STRIPE_WEBHOOK_SIGNING_SECRET` goes on **Supabase**
   (Edge Function secrets), not Vercel.
3. Set `ALLOWED_ORIGINS` to include the deployed domain, e.g.
   `https://your-app.vercel.app,http://localhost:5173`. (This gates
   `/api/generate` only — login talks to Supabase directly and is unaffected.)
4. If the production URL must be public, check **Settings → Deployment
   Protection** and keep Vercel Authentication limited to preview deployments.

`vercel.json` adds a strict Content-Security-Policy and related security headers
to every response. Note the login gates the **UI** only — `api/generate.js` still
authorizes by Origin + rate limit, not by Supabase session.

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
