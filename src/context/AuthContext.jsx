import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

const AuthContext = createContext(null);

// Normalize whatever Supabase throws into a short, user-facing string.
function messageFrom(error) {
  if (!error) return '';
  return error.message || 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Access entitlement (the one-time $9.99 purchase). `null` = not resolved yet
  // for the current user; `true` / `false` once the profiles row has been read.
  const [isPaid, setIsPaid] = useState(null);
  const [entitlementLoading, setEntitlementLoading] = useState(false);
  // Whether the user has a linked Stripe customer. False for accounts whose
  // membership was granted without Stripe (the shared demo account), so the
  // header can hide "Manage billing", which would find nothing.
  const [hasBillingAccount, setHasBillingAccount] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Read `profiles.is_paid` for the signed-in user. It reflects the user's
  // Stripe subscription state and is written only by the stripe-webhook Edge
  // Function (the payment columns are service-role-only writable — see the
  // add_payment_fields_to_profiles / switch_profiles_to_subscription
  // migrations). `silent` skips the loading flag for background re-checks.
  // Resolves to the read value: `true` / `false`, or `null` on a read error.
  const fetchEntitlement = useCallback(async (userId, { silent = false } = {}) => {
    if (!userId) {
      setIsPaid(null);
      setHasBillingAccount(false);
      setEntitlementLoading(false);
      return null;
    }
    if (!silent) setEntitlementLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_paid, stripe_customer_id')
        .eq('id', userId)
        .maybeSingle();
      if (error) {
        // Leave `isPaid` as-is on a transient read failure rather than locking
        // a paid user out; the paywall re-polls and App keeps showing a spinner
        // only while `isPaid` is still null.
        console.error('Failed to read entitlement:', error.message);
        setIsPaid((prev) => (prev === null ? false : prev));
        return null;
      }
      const paid = Boolean(data?.is_paid);
      setIsPaid(paid);
      setHasBillingAccount(Boolean(data?.stripe_customer_id));
      return paid;
    } finally {
      if (!silent) setEntitlementLoading(false);
    }
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    setIsPaid(null);
    fetchEntitlement(userId);
  }, [userId, fetchEntitlement]);

  // Re-validate access for an already-open session: a subscription can lapse
  // (canceled, payment failed) mid-session, and the user should drop to the
  // paywall without needing to reload. Poll on an interval and on tab focus.
  useEffect(() => {
    if (!userId) return undefined;
    const recheck = () => fetchEntitlement(userId, { silent: true });
    const interval = setInterval(recheck, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', recheck);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', recheck);
    };
  }, [userId, fetchEntitlement]);

  const refreshEntitlement = useCallback(
    (opts) => fetchEntitlement(userId, opts),
    [fetchEntitlement, userId],
  );

  const signUp = useCallback(async ({ name, email, password }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name.trim() } },
    });
    if (error) return { error: messageFrom(error) };
    // With email confirmation on, there's a user but no session yet.
    const needsConfirmation = !data.session;
    return { error: '', needsConfirmation };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: messageFrom(error) };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    return { error: messageFrom(error) };
  }, []);

  const value = useMemo(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      // full_name is set from options.data at signup; fall back to the email.
      displayName:
        session?.user?.user_metadata?.full_name || session?.user?.email || '',
      isPaid,
      hasBillingAccount,
      entitlementLoading,
      refreshEntitlement,
      signUp,
      signIn,
      signOut,
    }),
    [
      loading,
      session,
      isPaid,
      hasBillingAccount,
      entitlementLoading,
      refreshEntitlement,
      signUp,
      signIn,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
