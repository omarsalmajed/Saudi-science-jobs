/* Server-only: this file imports "@/lib/supabase/server", which pulls in
 * next/headers. Never import this from a "use client" component — import
 * "@/lib/job-shared" instead, which is re-exported below for convenience in
 * Server Components and Server Actions. */

import { publicClient, configured } from "./supabase/server";

export * from "./job-shared";
import type { Job } from "./job-shared";

/** The public feed. RLS already limits this to published rows from the last 30
 *  days; the explicit filters here are belt and braces, and they let the query
 *  use the (status, posted_at) index. */
export async function fetchPublishedJobs(): Promise<{ jobs: Job[]; error: string | null }> {
  if (!configured) {
    return { jobs: [], error: "supabase-not-configured" };
  }
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await publicClient()
    .from("jobs")
    .select("*")
    .eq("status", "published")
    .gte("posted_at", cutoff)
    .order("posted_at", { ascending: false })
    .limit(500);

  if (error) return { jobs: [], error: error.message };
  return { jobs: (data ?? []) as Job[], error: null };
}
