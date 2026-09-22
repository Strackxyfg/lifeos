"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import { onboardingSchema, splitThoughts, starterBrain } from "@/lib/onboarding";
import { heuristicRegion } from "@/lib/brain/classify";
import { classifyTexts } from "@/lib/ai/brain-ai";
import { canonicalPair, sameLink } from "@/lib/brain/graph";
import { normalize } from "@/lib/brain/text";
import { kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { loadStoredProfile, saveProfile } from "@/lib/user/profile";

export type OnboardingResult =
  | {
      ok: true;
      /** The notes the brain starts with, new or already there. */
      notes: { id: string; title: string; category: BrainCategoryId; isNew: boolean }[];
      linked: number;
      /** False while migration 007 is pending: the profile lives in a cookie only. */
      profileStored: boolean;
    }
  | { ok: false; code: "unauthorized" | "invalid" | "failed" };

/**
 * Finishes onboarding: saves who the person is, and builds their second brain.
 *
 * Safe to run twice — a double click, a retry after a network error, or a
 * second pass through onboarding months later. A planned note whose title
 * already exists in the brain (ignoring case and accents) is reused rather
 * than duplicated, and a link that already exists is left alone. So a failure
 * halfway is fixed by simply submitting again.
 *
 * Goals and the next step have fixed regions. The free-form thoughts are
 * filed by the model when one is configured, by keyword rules otherwise: the
 * person sees where each landed and can move it in one click.
 */
export async function completeOnboarding(input: unknown): Promise<OnboardingResult> {
  // Strict key: the demo fallback would write this person's goals into the
  // shared demo brain.
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return { ok: false, code: "unauthorized" };

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const answers = parsed.data;

  try {
    const store = getStore();
    // Each line of "what's on your mind" is filed by the model when there is
    // one — "a referral programme" is an idea, "our best clients come by word
    // of mouth" an insight, which keywords cannot tell — and by the keyword
    // rules otherwise, or if the model fails. Onboarding never waits on AI to
    // succeed.
    const lines = splitThoughts(answers.mind);
    const byModel = await classifyTexts(lines).catch(() => lines.map(() => null));
    const regionOf = new Map(lines.map((l, i) => [l, byModel[i]]));
    const plan = starterBrain(answers, (text) => regionOf.get(text) ?? heuristicRegion(text));

    // 1 — Notes. Reuse by title, create the rest, in plan order.
    const existing = await store.list(userKey, "brain");
    const byTitle = new Map(existing.map((n) => [normalize(n.title ?? ""), n.id]));
    const idByKey = new Map<string, string>();
    const notes: Extract<OnboardingResult, { ok: true }>["notes"] = [];

    for (const planned of plan.notes) {
      const found = byTitle.get(normalize(planned.title));
      if (found) {
        idByKey.set(planned.key, found);
        notes.push({ id: found, title: planned.title, category: planned.category, isNew: false });
        continue;
      }
      const created = await store.insert(userKey, "brain", {
        title: planned.title,
        detail: null,
        category: planned.category,
        kind: kindForCategory[planned.category],
        seedKey: null,
        done: false,
        ai: false,
      });
      byTitle.set(normalize(planned.title), created.id);
      idByKey.set(planned.key, created.id);
      notes.push({ id: created.id, title: planned.title, category: planned.category, isNew: true });
    }

    // 2 — Links. Optional: before migration 007 the table is missing, and the
    // notes are still worth having.
    let linked = 0;
    try {
      const links = await store.list(userKey, "links");
      const typed = await store.supportsSynapses();
      for (const [a, b] of plan.links) {
        const ida = idByKey.get(a);
        const idb = idByKey.get(b);
        if (!ida || !idb || ida === idb) continue;
        if (!links.some((l) => sameLink(l, ida, idb))) {
          const [fromId, toId] = canonicalPair(ida, idb);
          await store.insert(userKey, "links", {
            fromId,
            toId,
            reason: null,
            origin: "user",
            // Planned links run from a step to the goal it serves.
            ...(typed ? { kind: "advances" as const, sourceId: ida.toLowerCase() } : {}),
          });
        }
        linked += 1;
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    // 3 — Profile. Last, so a brain that failed to build never looks "done".
    const prior = await loadStoredProfile();
    const { stored } = await saveProfile(userKey, {
      name: answers.name,
      profession: answers.profession,
      answers: { ...(prior?.answers ?? {}), areas: answers.areas },
      onboardedAt: prior?.onboardedAt ?? new Date().toISOString(),
    });

    revalidatePath("/", "layout");
    return { ok: true, notes, linked, profileStored: stored };
  } catch (err) {
    console.error("[onboarding] failed", err);
    return { ok: false, code: "failed" };
  }
}
