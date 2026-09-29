import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { loadWorkspace } from "@/lib/data/live";
import { getStore } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { ReviewBoard, type ReviewData } from "@/components/review/review-board";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  const [m, data, enabled] = await Promise.all([getMessages(), loadWorkspace(), getStore().supportsFounder()]);
  // Only what the week's facts need, not the whole brain's text.
  const review: ReviewData = {
    notes: data.brain.map((n) => ({ id: n.id, title: n.title ?? n.detail?.slice(0, 80) ?? "", createdAt: n.createdAt })),
    reminders: data.reminders.map((r) => ({ title: r.title, doneAt: r.doneAt })),
    transactions: data.transactions.map((t) => ({ type: t.type, amount: Number(t.amount), occurredOn: t.occurredOn ?? null })),
    deals: data.deals.map((d) => ({ name: d.name, createdAt: d.createdAt })),
    reviews: data.reviews.map((r) => ({ weekStart: r.weekStart, wins: r.wins, blockers: r.blockers, lessons: r.lessons, focus: r.focus, decisions: r.decisions ?? [] })),
  };
  return (
    <>
      <PageHeader title={m.founder.review.title} description={m.founder.review.subtitle} />
      <ReviewBoard data={review} enabled={enabled} />
    </>
  );
}
