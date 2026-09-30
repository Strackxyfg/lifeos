"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";
import type { BrainLink, BrainNote } from "@/lib/brain/graph";
import { coverage, type TraitLike } from "@/lib/self/portrait";
import { followUps, questionsFor, type Question } from "@/lib/self/questions";
import { localDayHour } from "@/lib/self/rhythm";
import type { SelfData } from "@/lib/self/store";
import { plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { questionText } from "./today-card";

/**
 * The double, as the brain's overview shows it: today's question — the one
 * its page will ask — and what is waiting for the person's word.
 */
export function DoubleCard({
  traits,
  checkins,
  notes,
  links,
  seed,
}: {
  traits: TraitLike[];
  checkins: SelfData["checkins"];
  notes: BrainNote[];
  links: BrainLink[];
  seed: string;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.self.card;
  const [question, setQuestion] = useState<Question | null | undefined>(undefined);

  // The day is the person's own: known in the browser only.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const now = new Date();
    const { day } = localDayHour(now, zone);
    const answered = new Set(checkins.map((c) => c.questionId).filter((q): q is string => !!q));
    const asked = questionsFor({ day, seed, coverage: coverage(traits), answered, followUps: followUps({ notes, links, now, answered }) });
    setQuestion(asked[0] ?? null);
  }, [traits, checkins, notes, links, seed]);

  const pending = traits.filter((x) => x.status === "proposed").length;
  const known = traits.filter((x) => x.status !== "rejected").length;

  return (
    <section aria-labelledby="double-card-title" className="mb-6 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 text-accent" />
        <h2 id="double-card-title" className="text-[0.875rem] font-medium">
          {t.title}
        </h2>
        {pending > 0 && <span className="rounded-full bg-accent/15 px-1.5 py-px text-[0.64rem] font-medium text-accent">{plural(locale, pending, t.pending)}</span>}
      </div>
      {question && (
        <>
          <p className="mt-2.5 text-[0.7rem] uppercase tracking-wider text-muted">{t.question}</p>
          <p className="mt-1 text-[0.86rem] leading-snug">{questionText(question, m)}</p>
        </>
      )}
      {known > 0 && <p className="mt-2 text-[0.72rem] text-muted-foreground">{plural(locale, known, t.traits)}</p>}
      <Link
        href="/brain/double"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background"
      >
        {question ? m.self.question.answer : t.open} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
