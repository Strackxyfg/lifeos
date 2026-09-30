import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { SecondBrain } from "@/components/brain/second-brain";
import { ExportMenu } from "@/components/brain/export-menu";
import { getMessages } from "@/lib/i18n/server";
import { getStore, getUserKey } from "@/lib/db/store";
import { aiAvailable } from "@/lib/ai/router";
import { voiceAvailable } from "@/lib/ai/voice";
import { loadBrainView } from "@/lib/brain/load";
import { hash } from "@/lib/brain/text";
import { isCategory } from "@/lib/data/brain";
import { loadSelfData } from "@/lib/self/store";
import { BrainTabs } from "@/components/self/brain-tabs";
import { DoubleCard } from "@/components/self/double-card";

export const metadata: Metadata = { title: "Second Brain" };

export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; dump?: string; decide?: string; region?: string }>;
}) {
  const m = await getMessages();
  const [{ notes, links, linksAvailable, dismissed }, userKey, synapses, memory, { note, dump, decide, region }] = await Promise.all([
    loadBrainView(m),
    getUserKey(),
    getStore().supportsSynapses(),
    getStore().supportsMemory(),
    searchParams,
  ]);
  const self = await loadSelfData(getStore(), userKey);

  return (
    <>
      <PageHeader title={m.pages.brain.title} description={m.pages.brain.desc} action={<ExportMenu />} />
      <BrainTabs active="brain" />
      <SecondBrain
        initialNotes={notes}
        // `toBrainLink` already keeps only what the client needs — never the owner key.
        initialLinks={links}
        initialDismissed={dismissed}
        linksAvailable={linksAvailable}
        synapses={synapses}
        memory={memory}
        aiEnabled={aiAvailable()}
        // `?note=<id>` opens a note directly: the assistant's sources and the
        // agent's messages link here.
        initialNoteId={typeof note === "string" ? note : null}
        // `?dump=1` opens the brain dump: the command menu links here.
        initialDump={dump === "1"}
        // `?decide=<link>` opens a tension's decision, `?region=next` a region: the double's advice links here.
        initialDecide={typeof decide === "string" ? decide : null}
        initialRegion={isCategory(region) ? region : null}
        double={
          self.available ? (
            <DoubleCard key="double" traits={self.traits} checkins={self.checkins} notes={notes} links={links} seed={String(hash(`double:${userKey}`))} />
          ) : undefined
        }
        voiceEnabled={voiceAvailable()}
        nowIso={new Date().toISOString()}
        // A salt for today's resurfaced note: derived from the owner, never the key itself.
        seed={String(hash(`resurface:${userKey}`))}
      />
    </>
  );
}
