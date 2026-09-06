// Single Supabase client for the browser. Auth only today (email/password),
// but any future data access goes through this instance too.
//
// Both vars are VITE_-prefixed and therefore land in the client bundle. That is
// expected for the publishable/anon key: it grants only what Row Level Security
// allows. It is NOT the same class of secret as WEBHOOK_SECRET (see CLAUDE.md).
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to ' +
      '.env and fill them in (see the README "Authentication" section).',
  );
}

export const supabase = createClient(url, anonKey);
