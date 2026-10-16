"use client";

import dynamic from "next/dynamic";
import type { MapEditorProps } from "./map-editor";

/**
 * The editor measures text with the page's own fonts and draws on a canvas:
 * it only runs in the browser. Until it is there, the bar and an empty map
 * hold its place, so nothing jumps.
 */
const MapEditor = dynamic(() => import("./map-editor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex flex-col bg-background" aria-busy="true">
      <div className="h-14 shrink-0 border-b border-border bg-surface/95" />
      <div className="grid flex-1 place-items-center">
        <div className="h-9 w-40 animate-pulse rounded-full bg-surface-2" />
      </div>
    </div>
  ),
});

export function MapEditorLoader(props: MapEditorProps) {
  return <MapEditor {...props} />;
}
