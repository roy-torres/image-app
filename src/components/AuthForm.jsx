import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const inputClass =
  'w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm ' +
  'outline-none transition focus:border-black/40 disabled:opacity-50';

export default function AuthForm() {
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isSignup = mode === 'signup';

  function switchMode() {
    setMode(isSignup ? 'signin' : 'signup');
    setError('');
    setNotice('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    setError('');
    setNotice('');
    setPending(true);
    try {
      const result = isSignup
        ? await signUp({ name, email, password })
        : await signIn({ email, password });

      if (result.error) {
        setError(result.error);
        return;
      }
      if (isSignup && result.needsConfirmation) {
        setNotice('Check your inbox to confirm your email, then sign in.');
        setMode('signin');
        setPassword('');
      }
      // On success the auth listener swaps the whole screen; nothing else to do.
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">
        {isSignup ? 'Create your account' : 'Sign in'}
      </h1>
      <p className="mt-1 text-sm text-black/55">
        {isSignup
          ? 'Sign up with your name, email, and a password.'
          : 'Welcome back. Enter your email and password.'}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        {isSignup && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-black/60">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              disabled={pending}
              className={inputClass}
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-black/60">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={pending}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-black/60">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            disabled={pending}
            className={inputClass}
          />
        </label>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-black/10 bg-canvas px-3 py-2 text-sm text-black/70">
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending
            ? isSignup
              ? 'Creating account…'
              : 'Signing in…'
            : isSignup
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-black/55">
        {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button
          type="button"
          onClick={switchMode}
          className="font-medium text-ink underline underline-offset-2 hover:text-black/70"
        >
          {isSignup ? 'Sign in' : 'Sign up'}
        </button>
      </p>
    </div>
  );
}
