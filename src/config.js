// Same-origin proxy route (api/generate.js) that forwards to the private n8n
// webhook. The real webhook URL lives only in server-side env vars and is never
// shipped to the browser. Override only if the API is hosted elsewhere.
export const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT ?? '/api/generate';

// Hosted Stripe Payment Link for the $9.99/month membership subscription. Public
// by nature (every buyer opens the same URL); safe to ship in the bundle. The
// paywall appends ?client_reference_id=<user id>&prefilled_email=<email> so the
// stripe-webhook Edge Function can link the Stripe customer to the account.
export const STRIPE_PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK ?? '';

// Stripe Customer Portal login link (Dashboard → Settings → Billing → Customer
// portal → "login link"). Static, public URL; lets a member update their card
// or cancel. Optional — when unset the "Manage billing" button is hidden and
// members are managed from the Stripe Dashboard.
export const STRIPE_BILLING_PORTAL_URL =
  import.meta.env.VITE_STRIPE_BILLING_PORTAL_URL ?? '';

// Longest edge (px) and JPEG quality used to downscale uploads in the browser
// before sending. Keeps requests under the serverless body limit and speeds
// things up; raise MAX_IMAGE_EDGE if you need more detail upstream.
export const MAX_IMAGE_EDGE = 1600;
export const IMAGE_QUALITY = 0.82;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // must stay <= api/generate.js cap
