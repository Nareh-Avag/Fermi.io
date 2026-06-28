import { createClient } from '@supabase/supabase-js';

// Vite exposes env vars prefixed with VITE_ on import.meta.env.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: createClient throws synchronously if the URL/key are missing, which
// would crash the entire app at import time. If config is absent we export a
// safe stub whose auth calls reject with a clear message, so the UI still
// renders and the error only surfaces inside the auth modal.
const makeStub = (reason) => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithPassword: async () => ({ data: null, error: { message: reason } }),
    signUp: async () => ({ data: null, error: { message: reason } }),
  },
});

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : makeStub('Auth is not configured (missing Supabase env vars).');
