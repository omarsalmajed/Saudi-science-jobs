/* Server component: fetches the live feed with the anon key, so row level
 * security is what decides which rows exist. Rendered fresh on every request —
 * the poller adds jobs every 30 minutes and a cached page would hide them. */

import JobBoard from "./JobBoard";
import { fetchPublishedJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const { jobs, error } = await fetchPublishedJobs();

  const notice =
    error === "supabase-not-configured"
      ? "لم يتم ربط قاعدة البيانات بعد."
      : error
        ? "تعذّر تحميل الوظائف حالياً. حاول لاحقاً."
        : null;

  if (error) console.error("public feed:", error);

  return <JobBoard jobs={jobs} notice={notice} />;
}
