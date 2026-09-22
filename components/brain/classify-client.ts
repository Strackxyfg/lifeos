import { isCategory, type BrainCategoryId } from "@/lib/data/brain";
import type { BrainLink, BrainNote } from "@/lib/brain/graph";
import type { Locale } from "@/lib/i18n/config";

/**
 * Asks the server which region a captured thought belongs to. Never throws:
 * any failure files it under thoughts, so a capture is never lost to an
 * outage — the person can move it in one click.
 */
export async function classifyThought(text: string, locale: Locale): Promise<BrainCategoryId> {
  try {
    const res = await fetch("/api/brain/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, locale }),
    });
    const data = (await res.json()) as { category?: string };
    return isCategory(data.category) ? data.category : "thoughts";
  } catch {
    return "thoughts";
  }
}

/**
 * Announces a note captured outside the brain page (the topbar), so an open
 * brain adds it without a reload. Its state is client-side and does not
 * follow a server refresh.
 */
export const CAPTURED_EVENT = "lifeos:captured";
/** Connections drawn outside the brain page, for an open brain to add. */
export const LINKED_EVENT = "lifeos:linked";
/** Opens the topbar capture from anywhere — the command menu uses it. */
export const OPEN_CAPTURE_EVENT = "lifeos:capture";

export function announceCaptured(note: BrainNote) {
  window.dispatchEvent(new CustomEvent<BrainNote>(CAPTURED_EVENT, { detail: note }));
}

export function announceLinked(links: BrainLink[]) {
  if (links.length) window.dispatchEvent(new CustomEvent<BrainLink[]>(LINKED_EVENT, { detail: links }));
}
