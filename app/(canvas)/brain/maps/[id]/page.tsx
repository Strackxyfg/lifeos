import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getUserKey } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { aiAvailable } from "@/lib/ai/router";
import { loadBrainView } from "@/lib/brain/load";
import { getMapStore } from "@/lib/maps/store";
import { MapEditorLoader } from "@/components/maps/map-editor-loader";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, m] = await Promise.all([params, getMessages()]);
  const store = getMapStore();
  const map = (await store.supports()) ? (await store.list(await getUserKey())).find((x) => x.id === id) : undefined;
  return { title: map ? `${map.title} · ${m.maps.title}` : m.maps.title };
}

export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getMapStore();
  // Without migration 016, the maps page says what is missing.
  if (!(await store.supports())) redirect("/brain/maps");
  const [m, userKey] = await Promise.all([getMessages(), getUserKey()]);
  const map = await store.get(userKey, id);
  if (!map) notFound();
  const { notes } = await loadBrainView(m);
  return (
    <MapEditorLoader
      id={map.id}
      initial={{ doc: map.doc, revision: map.revision, updatedAt: map.updatedAt, hasPreview: !!map.preview }}
      // Only what linking an idea to a note needs: an id and a title.
      notes={notes.map((n) => ({ id: n.id, title: n.title }))}
      aiEnabled={aiAvailable()}
    />
  );
}
