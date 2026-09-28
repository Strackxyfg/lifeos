import type { Metadata } from "next";
import { JoinCard } from "@/components/team/team-list";
import { getMessages } from "@/lib/i18n/server";
import { getUserKey } from "@/lib/db/store";
import { getTeamStore, inviteHash } from "@/lib/team/store";
import { getProfile } from "@/lib/user/profile";

export const metadata: Metadata = { title: "Join a team", robots: { index: false } };

/**
 * An invitation link. Behind sign-in (the middleware sends a signed-out
 * visitor to log in, then back here). It says which team invites and how
 * many are in it — nothing about them — and joining is one confirmation.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, m, userKey, profile] = await Promise.all([params, getMessages(), getUserKey(), getProfile()]);
  const store = getTeamStore();
  const valid = /^[A-Za-z0-9_-]{16,128}$/.test(token) && (await store.supportsTeams());
  const preview = valid ? await store.previewInvite(userKey, inviteHash(token)) : { state: "invalid" as const, team: null };
  return (
    <div className="py-8">
      <span className="sr-only">{m.team.title}</span>
      <JoinCard token={token} preview={preview} suggestedName={profile.name === "there" ? "" : profile.name} />
    </div>
  );
}
