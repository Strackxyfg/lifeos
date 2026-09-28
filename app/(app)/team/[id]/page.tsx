import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamSpace } from "@/components/team/team-space";
import { getMessages } from "@/lib/i18n/server";
import { getUserKey } from "@/lib/db/store";
import { loadTeamPage } from "@/lib/team/load";
import { getTeamStore } from "@/lib/team/store";

export const metadata: Metadata = { title: "Team" };

/** A team's space — or nothing at all to anyone who is not in it (not even whether it exists). */
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, m, userKey] = await Promise.all([params, getMessages(), getUserKey()]);
  if (!/^[0-9a-f-]{8,64}$/i.test(id) || !(await getTeamStore().supportsTeams())) notFound();
  const view = await loadTeamPage(userKey, id, m);
  if (!view) notFound();
  return <TeamSpace view={view} />;
}
