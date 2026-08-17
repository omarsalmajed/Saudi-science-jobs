/* Three different Supabase identities, deliberately kept apart.
 *
 *   publicClient()   anon key, no session — the public job feed. RLS decides
 *                    what comes back, so a policy mistake fails closed.
 *   sessionClient()  anon key + the visitor's cookie — used to find out who an
 *                    admin is and to moderate as them, still under RLS.
 *   serviceClient()  service-role key, bypasses RLS. Server-only, and only for
 *                    writes the browser must never be trusted with.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

/** True when the site has been given its Supabase credentials. */
export const configured = Boolean(URL && ANON);

function need(v: string | undefined, name: string): string {
  if (!v) throw new Error(`${name} is not set — see .env.example`);
  return v;
}

export function publicClient() {
  return createClient(need(URL, "NEXT_PUBLIC_SUPABASE_URL"), need(ANON, "NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sessionClient() {
  const store = await cookies();
  return createServerClient(
    need(URL, "NEXT_PUBLIC_SUPABASE_URL"),
    need(ANON, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a Server Component render, where cookies are frozen.
            // Middleware refreshes the session instead, so this is safe to drop.
          }
        },
      },
    },
  );
}

/** Never import this from a client component. */
export function serviceClient() {
  return createClient(need(URL, "NEXT_PUBLIC_SUPABASE_URL"), need(SERVICE, "SUPABASE_SERVICE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
