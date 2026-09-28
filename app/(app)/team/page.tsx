import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { TeamList } from "@/components/team/team-list";
import { getMessages } from "@/lib/i18n/server";
import { getUserKey } from "@/lib/db/store";
import { loadTeams } from "@/lib/team/load";
import { getProfile } from "@/lib/user/profile";

export const metadata: Metadata = { title: "Team" };

/**
 * Your teams and circles. With exactly one, the island's club house opens
 * straight into it; `?all=1` shows the list (to create another).
 */
export default async function TeamIndexPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const [m, userKey, profile, { all }] = await Promise.all([getMessages(), getUserKey(), getProfile(), searchParams]);
  const { available, teams } = await loadTeams(userKey);
  if (available && teams.length === 1 && all !== "1") redirect(`/team/${teams[0].id}`);
  return (
    <>
      <PageHeader title={m.team.title} description={m.team.subtitle} />
      <TeamList teams={teams} available={available} suggestedName={profile.name === "there" ? "" : profile.name} />
    </>
  );
}
