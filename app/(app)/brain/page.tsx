import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { SecondBrain } from "@/components/brain/second-brain";
import { ExportMenu } from "@/components/brain/export-menu";
import { getMessages } from "@/lib/i18n/server";
import { getStore, getUserKey } from "@/lib/db/store";
import { getAI } from "@/lib/ai/client";
import { loadBrainView } from "@/lib/brain/load";
import { hash } from "@/lib/brain/text";

export const metadata: Metadata = { title: "Second Brain" };

export default async function BrainPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const m = await getMessages();
  const [{ notes, links, linksAvailable, dismissed }, userKey, synapses, { note }] = await Promise.all([
    loadBrainView(m),
    getUserKey(),
    getStore().supportsSynapses(),
    searchParams,
  ]);

  return (
    <>
      <PageHeader title={m.pages.brain.title} description={m.pages.brain.desc} action={<ExportMenu />} />
      <SecondBrain
        initialNotes={notes}
        // `toBrainLink` already keeps only what the client needs — never the owner key.
        initialLinks={links}
        initialDismissed={dismissed}
        linksAvailable={linksAvailable}
        synapses={synapses}
        aiEnabled={getAI() !== null}
        // `?note=<id>` opens a note directly: the assistant's sources and the
        // agent's messages link here.
        initialNoteId={typeof note === "string" ? note : null}
        nowIso={new Date().toISOString()}
        // A salt for today's resurfaced note: derived from the owner, never the key itself.
        seed={String(hash(`resurface:${userKey}`))}
      />
    </>
  );
}
