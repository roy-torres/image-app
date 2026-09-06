import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { STRIPE_PAYMENT_LINK } from '../config.js';
import Spinner from './Spinner.jsx';

// Shown to a signed-in user without an active membership. The Studio in
// App.jsx only renders once `isPaid` is true; the stripe-webhook Edge Function
// flips that flag from Stripe subscription events.
const POLL_MS = 4000;

export default function Paywall() {
  const { user, displayName, signOut, refreshEntitlement, entitlementLoading } =
    useAuth();

  // Payment Link + identity so the webhook can map the payment to this account.
  const buyUrl = useMemo(() => {
    if (!STRIPE_PAYMENT_LINK) return '';
    try {
      const url = new URL(STRIPE_PAYMENT_LINK);
      if (user?.id) url.searchParams.set('client_reference_id', user.id);
      if (user?.email) url.searchParams.set('prefilled_email', user.email);
      return url.toString();
    } catch {
      return '';
    }
  }, [user?.id, user?.email]);

  // Feedback for the manual "I've already subscribed" check: null (idle),
  // 'none' (checked, still no active membership), 'error' (couldn't reach it).
  const [checkResult, setCheckResult] = useState(null);

  async function handleManualCheck() {
    setCheckResult(null);
    const paid = await refreshEntitlement();
    // paid === true unmounts this screen via the App gate; nothing to show.
    if (paid === false) setCheckResult('none');
    else if (paid == null) setCheckResult('error');
  }

  // Keep a ref so the poll/effect below doesn't need refreshEntitlement in deps.
  const refreshRef = useRef(refreshEntitlement);
  useEffect(() => {
    refreshRef.current = refreshEntitlement;
  }, [refreshEntitlement]);

  // On return from Stripe (redirect adds ?paid=1): re-check immediately and
  // strip the param. Then poll so a completed payment flips the gate on its own.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('paid')) {
      params.delete('paid');
      const qs = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (qs ? `?${qs}` : ''),
      );
      refreshRef.current({ silent: true });
    }

    const id = setInterval(() => refreshRef.current({ silent: true }), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const configured = Boolean(buyUrl);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-black/10 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <span className="text-sm font-semibold tracking-[0.25em] uppercase">
            Virtual Try-On
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-black/55 sm:inline">{displayName}</span>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-full border border-black/20 px-4 py-1.5 font-medium transition hover:bg-black/5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Membership required</h1>
          <p className="mt-1 text-sm text-black/55">
            Your account is ready. Subscribe to unlock the Studio — cancel
            anytime from <span className="whitespace-nowrap">Manage billing</span>.
          </p>

          <div className="mt-5 flex items-baseline justify-center gap-1">
            <span className="text-3xl font-semibold">$9.99</span>
            <span className="text-sm text-black/45">/ month</span>
          </div>

          {configured ? (
            <a
              href={buyUrl}
              className="mt-5 block w-full rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-black/85"
            >
              Subscribe — $9.99/mo
            </a>
          ) : (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Payments aren&rsquo;t configured yet. Set{' '}
              <code className="font-mono">VITE_STRIPE_PAYMENT_LINK</code> and
              redeploy.
            </div>
          )}

          <button
            type="button"
            onClick={handleManualCheck}
            disabled={entitlementLoading}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/20 px-6 py-2.5 text-sm font-medium transition hover:bg-black/5 disabled:opacity-40"
          >
            {entitlementLoading && <Spinner className="!h-4 !w-4" />}
            {entitlementLoading ? 'Checking…' : "I've already subscribed"}
          </button>

          {checkResult === 'none' && (
            <p className="mt-3 rounded-xl border border-black/10 bg-canvas px-3 py-2 text-xs text-black/60">
              No active membership found for{' '}
              <span className="font-medium">{user?.email}</span> yet. If you just
              subscribed, give it a few seconds and try again — this also checks
              itself automatically. If you paid with a different email, that&rsquo;s
              the mismatch.
            </p>
          )}
          {checkResult === 'error' && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Couldn&rsquo;t check your membership just now. Check your connection
              and try again.
            </p>
          )}

          <p className="mt-4 text-xs text-black/40">
            Subscribing with a different email? Use{' '}
            <span className="font-medium">{user?.email}</span> at checkout so we
            can match the subscription to this account.
          </p>
        </div>
      </main>
    </div>
  );
}
