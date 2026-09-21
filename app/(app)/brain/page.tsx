import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { SecondBrain } from "@/components/brain/second-brain";
import { ExportMenu } from "@/components/brain/export-menu";
import type { ClientLink } from "@/components/brain/note-detail";
import { getMessages } from "@/lib/i18n/server";
import { getUserKey } from "@/lib/db/store";
import { loadBrainView } from "@/lib/brain/load";
import { hash } from "@/lib/brain/text";

export const metadata: Metadata = { title: "Second Brain" };

export default async function BrainPage() {
  const m = await getMessages();
  const [{ notes, links, linksAvailable }, userKey] = await Promise.all([loadBrainView(m), getUserKey()]);

  // Only what the client needs: never the owner key on each row.
  const clientLinks: ClientLink[] = links.map((l) => ({
    id: l.id,
    fromId: l.fromId,
    toId: l.toId,
    reason: l.reason,
    origin: l.origin,
  }));

  return (
    <>
      <PageHeader title={m.pages.brain.title} description={m.pages.brain.desc} action={<ExportMenu />} />
      <SecondBrain
        initialNotes={notes}
        initialLinks={clientLinks}
        linksAvailable={linksAvailable}
        nowIso={new Date().toISOString()}
        // A salt for today's resurfaced note: derived from the owner, never the key itself.
        seed={String(hash(`resurface:${userKey}`))}
      />
    </>
  );
}
