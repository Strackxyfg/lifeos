import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TeamList } from "@/components/team/team-list";
import { getMessages } from "@/lib/i18n/server";
import { getUserKey } from "@/lib/db/store";
import { loadTeams } from "@/lib/team/load";
import { getProfile } from "@/lib/user/profile";

export const metadata: Metadata = { title: "Team" };

/**
 * Your teams and circles. With exactly one, the island's club house opens
 * straight into it; `?all=1` shows the list (to create another). After a
 * single sign-on that could not bring the person into their company's
 * team, `?sso=` says why — and the list stays, so it can be read.
 */
export default async function TeamIndexPage({ searchParams }: { searchParams: Promise<{ all?: string; sso?: string }> }) {
  const [m, userKey, profile, { all, sso }] = await Promise.all([getMessages(), getUserKey(), getProfile(), searchParams]);
  const { available, teams } = await loadTeams(userKey);
  const notice = sso && sso in m.team.ssoNotice ? m.team.ssoNotice[sso as keyof typeof m.team.ssoNotice] : null;
  if (available && teams.length === 1 && all !== "1" && !notice) redirect(`/team/${teams[0].id}`);
  return (
    <>
      <PageHeader title={m.team.title} description={m.team.subtitle} />
      {notice && (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          {notice}
        </p>
      )}
      <TeamList teams={teams} available={available} suggestedName={profile.name === "there" ? "" : profile.name} />
    </>
  );
}
