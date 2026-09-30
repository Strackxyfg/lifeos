import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { DoubleView } from "@/components/self/double-view";
import { getMessages } from "@/lib/i18n/server";
import { getStore, getUserKey } from "@/lib/db/store";
import { aiAvailable } from "@/lib/ai/router";
import { loadBrainView } from "@/lib/brain/load";
import { loadReminders } from "@/lib/data/live";
import { loadSelfData } from "@/lib/self/store";
import { getProfile } from "@/lib/user/profile";
import { hash } from "@/lib/brain/text";

export const metadata: Metadata = { title: "Your double" };

/**
 * The double: what the second brain understands of the person — their
 * portrait, how they have been, the day's question — what it suggests, and
 * a conversation with it. Everything it shows is computed from their own
 * data; everything it proposes waits for their word.
 */
export default async function DoublePage() {
  const m = await getMessages();
  const userKey = await getUserKey();
  const [{ notes, links }, self, { reminders }, profile] = await Promise.all([
    loadBrainView(m),
    loadSelfData(getStore(), userKey),
    loadReminders(),
    getProfile(),
  ]);

  return (
    <>
      <PageHeader title={m.self.title} description={m.self.desc} />
      <DoubleView
        available={self.available}
        aiEnabled={aiAvailable()}
        initialNotes={notes}
        initialLinks={links}
        initialTraits={self.traits}
        initialCheckins={self.checkins}
        initialAdvice={self.advice}
        // Only what advice needs: whether a note already has a reminder coming.
        initialReminders={reminders.map((r) => ({ noteId: r.noteId, done: r.done, dueAt: r.dueAt }))}
        name={profile.name === "there" ? null : profile.firstName}
        // A salt for the day's questions: derived from the owner, never the key itself.
        seed={String(hash(`double:${userKey}`))}
      />
    </>
  );
}
