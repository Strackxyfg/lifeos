import type { Metadata } from "next";
import { FlaskConical, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { AssessmentFlow } from "@/components/assessment/assessment-flow";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Assessment" };

export default async function AssessmentPage() {
  const m = await getMessages();

  return (
    <>
      <PageHeader title={m.assessment.title} description={m.assessment.desc} />

      {/* The two modules are labelled up front — the user should know which
          part is a validated instrument and which is our own calibration. */}
      <div className="mx-auto mb-8 grid max-w-2xl gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <span className="flex items-center gap-2 text-[0.8125rem] font-medium">
            <FlaskConical className="h-4 w-4 text-accent" />
            {m.assessment.moduleValidated}
          </span>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            Mini-IPIP (Donnellan et al., 2006) · 20 items · public domain · α ≈ .65–.77
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <span className="flex items-center gap-2 text-[0.8125rem] font-medium">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            {m.assessment.moduleCalibration}
          </span>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted-foreground">
            12 items on delegation, risk and communication. Purpose-built — not a validated scale.
          </p>
        </div>
      </div>

      <AssessmentFlow />
    </>
  );
}
