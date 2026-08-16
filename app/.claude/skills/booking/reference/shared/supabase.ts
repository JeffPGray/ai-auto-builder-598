import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for the booking system, authenticated with the
 * service-role key. Installed by the Klaudius booking skill as
 * `src/lib/booking/supabase.ts`. Generic plumbing — do not edit per site.
 *
 * SECURITY: the service-role key bypasses Row Level Security and can read the
 * operator's entire Supabase project. It must only ever exist as a runtime
 * env var on the Vercel project (SUPABASE_URL + SUPABASE_SERVICE_KEY) and must
 * only be imported from server code (API routes, server components). Never
 * prefix these vars with NEXT_PUBLIC_, never import this file from a client
 * component.
 */

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
