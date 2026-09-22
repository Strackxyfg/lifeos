"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { isMissingTable } from "@/lib/db/errors";
import { onboardingSchema, starterBrain } from "@/lib/onboarding";
import { heuristicRegion } from "@/lib/brain/classify";
import { canonicalPair, sameLink } from "@/lib/brain/graph";
import { normalize } from "@/lib/brain/text";
import { kindForCategory, type BrainCategoryId } from "@/lib/data/brain";
import { loadStoredProfile, saveProfile } from "@/lib/user/profile";

export type OnboardingResult =
  | {
      ok: true;
      /** The notes the brain starts with, new or already there. */
      notes: { title: string; category: BrainCategoryId; isNew: boolean }[];
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
 * Classification uses the keyword heuristic, not the model: onboarding must
 * not depend on an AI key, and the person sees where each note landed and
 * can move it in one click.
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
    const plan = starterBrain(answers, heuristicRegion);

    // 1 — Notes. Reuse by title, create the rest, in plan order.
    const existing = await store.list(userKey, "brain");
    const byTitle = new Map(existing.map((n) => [normalize(n.title ?? ""), n.id]));
    const idByKey = new Map<string, string>();
    const notes: Extract<OnboardingResult, { ok: true }>["notes"] = [];

    for (const planned of plan.notes) {
      const found = byTitle.get(normalize(planned.title));
      if (found) {
        idByKey.set(planned.key, found);
        notes.push({ title: planned.title, category: planned.category, isNew: false });
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
      notes.push({ title: planned.title, category: planned.category, isNew: true });
    }

    // 2 — Links. Optional: before migration 007 the table is missing, and the
    // notes are still worth having.
    let linked = 0;
    try {
      const links = await store.list(userKey, "links");
      for (const [a, b] of plan.links) {
        const ida = idByKey.get(a);
        const idb = idByKey.get(b);
        if (!ida || !idb || ida === idb) continue;
        if (!links.some((l) => sameLink(l, ida, idb))) {
          const [fromId, toId] = canonicalPair(ida, idb);
          await store.insert(userKey, "links", { fromId, toId, reason: null, origin: "user" });
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
