// Stripe webhook -> Supabase. Keeps `profiles.is_paid` in sync with the user's
// Stripe **subscription** ($9.99/month). When a subscription stops being active
// (canceled, past_due, unpaid, ...) the row is flipped back to is_paid = false
// and the app drops the user to the paywall.
//
// Deployed as a Supabase Edge Function with `verify_jwt = false`: Stripe cannot
// send a Supabase JWT, so this function authenticates the request itself by
// verifying the Stripe signature (HMAC-SHA256 over `${timestamp}.${body}` with
// the endpoint's signing secret). No SDKs — same posture as api/generate.js.
//
// Env (Edge Function secrets):
//   STRIPE_WEBHOOK_SIGNING_SECRET  - `whsec_...` from the Stripe webhook endpoint (REQUIRED, set manually)
//   SUPABASE_URL                   - auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY      - auto-injected by Supabase (bypasses RLS + column grants)
//
// Events handled (configured on the Stripe webhook endpoint):
//   checkout.session.completed      - first signup; the ONLY event carrying
//                                     client_reference_id, so this is where the
//                                     Stripe customer id gets linked to the user.
//   customer.subscription.created   - matched to the user by stripe_customer_id
//   customer.subscription.updated     (status active/trialing -> is_paid true,
//   customer.subscription.deleted      anything else -> is_paid false)

// `.trim()` — a secret pasted into the dashboard often picks up a trailing
// newline, which would silently break every signature check.
const SIGNING_SECRET = (Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET") ?? "").trim();
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

const SIGNATURE_TOLERANCE_SEC = 300;
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify a Stripe-Signature header. Returns true only if a `v1` signature over
// `${t}.${payload}` matches and the timestamp is within tolerance.
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  let timestamp = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (k === "t") timestamp = val;
    else if (k === "v1") v1.push(val);
  }
  if (!timestamp || v1.length === 0) return false;

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_TOLERANCE_SEC) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return v1.some((sig) => timingSafeEqual(expected, sig));
}

// PATCH public.profiles with the service role (bypasses RLS + the column grant).
// Returns the number of rows updated.
async function patchProfiles(
  filter: string,
  patch: Record<string, unknown>,
): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${filter}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Supabase PATCH ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as any).id === "string") {
    return (v as any).id;
  }
  return null;
}

async function handleEvent(event: {
  type: string;
  data: { object: Record<string, any> };
}): Promise<void> {
  // First signup: link the Stripe customer to the Supabase user and grant access.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode !== "subscription") return;

    const userId: string | null = session.client_reference_id ?? null;
    if (!userId) {
      console.warn(
        `stripe-webhook: checkout session ${session.id} has no client_reference_id; cannot map to a user`,
      );
      return;
    }

    const updated = await patchProfiles(`id=eq.${encodeURIComponent(userId)}`, {
      is_paid: true,
      paid_at: new Date().toISOString(),
      subscription_status: "active",
      stripe_customer_id: idOf(session.customer),
      stripe_subscription_id: idOf(session.subscription),
      stripe_checkout_session_id: session.id,
    });
    console.log(
      updated === 0
        ? `stripe-webhook: no profile matched id=${userId} for checkout ${session.id}`
        : `stripe-webhook: activated profile ${userId} (checkout ${session.id})`,
    );
    return;
  }

  // Ongoing subscription lifecycle. These events do NOT carry the Supabase user
  // id, so they are matched by the stripe_customer_id linked at checkout.
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object;
    const customerId = idOf(sub.customer);
    if (!customerId) {
      console.warn(`stripe-webhook: ${event.type} ${sub.id} has no customer`);
      return;
    }

    const deleted = event.type === "customer.subscription.deleted";
    const status: string = deleted ? "canceled" : sub.status;
    const active = !deleted && ACTIVE_STATUSES.has(sub.status);
    const periodEndUnix =
      sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

    const patch = {
      is_paid: active,
      subscription_status: status,
      stripe_subscription_id: sub.id,
      current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
    };
    const filter = `stripe_customer_id=eq.${encodeURIComponent(customerId)}`;

    // At signup, `customer.subscription.created` can land in a separate
    // concurrent invocation that races `checkout.session.completed` (which is
    // what writes stripe_customer_id). If nothing matched yet, wait briefly and
    // try once more so this event isn't silently lost.
    let updated = await patchProfiles(filter, patch);
    if (updated === 0) {
      await new Promise((r) => setTimeout(r, 2500));
      updated = await patchProfiles(filter, patch);
    }
    console.log(
      updated === 0
        ? `stripe-webhook: no profile matched customer=${customerId} for ${event.type}`
        : `stripe-webhook: ${event.type} -> profile customer=${customerId} is_paid=${active} status=${status}`,
    );
    return;
  }

  // Any other event type: acknowledged and ignored.
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!SIGNING_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error("stripe-webhook is missing required env (signing secret / Supabase creds).");
    return json(500, { error: "Server is not configured." });
  }
  if (!signature) return json(400, { error: "Missing Stripe-Signature header." });

  if (!(await verifyStripeSignature(body, signature, SIGNING_SECRET))) {
    console.warn("stripe-webhook: signature verification failed");
    return json(400, { error: "Invalid signature." });
  }

  let event: { type: string; data: { object: Record<string, any> } };
  try {
    event = JSON.parse(body);
  } catch {
    return json(400, { error: "Invalid JSON." });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // 5xx -> Stripe retries the delivery.
    console.error("stripe-webhook: handler failed:", err);
    return json(500, { error: "Webhook handler failed." });
  }

  return json(200, { received: true });
});
