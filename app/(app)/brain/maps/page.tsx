import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { BrainTabs } from "@/components/self/brain-tabs";
import { MapGallery } from "@/components/maps/map-gallery";
import { getUserKey } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { loadBrainView } from "@/lib/brain/load";
import { getMapStore } from "@/lib/maps/store";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.maps.title };
}

export default async function MapsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [m, { new: fresh }] = await Promise.all([getMessages(), searchParams]);
  const store = getMapStore();
  const supported = await store.supports();
  const [maps, { notes }] = await Promise.all([supported ? store.list(await getUserKey()) : Promise.resolve([]), loadBrainView(m)]);

  return (
    <>
      <PageHeader title={m.maps.title} description={m.maps.desc} />
      <BrainTabs active="maps" />
      {supported ? (
        <MapGallery
          maps={maps.map((x) => ({ id: x.id, title: x.title, nodeCount: x.nodeCount, preview: x.preview, updatedAt: x.updatedAt }))}
          notes={notes.map((n) => ({ id: n.id, title: n.title }))}
          nowIso={new Date().toISOString()}
          // `?new=1` opens the new map dialog: the command menu links here.
          initialNew={fresh === "1"}
        />
      ) : (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-[0.875rem] leading-relaxed">{m.maps.pending}</p>
      )}
    </>
  );
}
