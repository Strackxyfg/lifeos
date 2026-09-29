"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck2 } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { isReviewTime, weekStartOf } from "@/lib/review/week";

/**
 * From Friday to Sunday, until this week's review is written: a quiet
 * invitation to write it. Decided in the browser — "Friday" is the
 * person's, not the server's.
 */
export function ReviewNudge({ reviewedWeeks }: { reviewedWeeks: string[] }) {
  const m = useMessages();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setShow(isReviewTime(today) && !reviewedWeeks.includes(weekStartOf(today)));
  }, [reviewedWeeks]);
  if (!show) return null;
  return (
    <Link
      href="/review"
      className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-[0.875rem] transition-colors hover:bg-accent/10"
    >
      <span className="flex items-center gap-2.5">
        <CalendarCheck2 className="h-4 w-4 text-accent" aria-hidden />
        {m.founder.review.dashboardCard}
      </span>
      <span className="text-[0.8125rem] font-medium text-accent">{m.founder.review.open}</span>
    </Link>
  );
}
