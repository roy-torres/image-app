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
      signUp,
      signIn,
      signOut,
    }),
    [loading, session, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
