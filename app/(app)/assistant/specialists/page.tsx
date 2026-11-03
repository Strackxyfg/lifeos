import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { SpecialistsManager, type ToolChoice } from "@/components/specialists/manager";
import { getCapability } from "@/lib/agent/capabilities";
import { getUserKey } from "@/lib/db/store";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getEdition, locked } from "@/lib/plans/server";
import { availableSpecialistTools } from "@/lib/specialists/available";
import { SPECIALIST_LIMITS } from "@/lib/specialists/model";
import { getSpecialistStore } from "@/lib/specialists/store";
import { fromTemplate, TEMPLATES } from "@/lib/specialists/templates";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).specialists.title };
}

export default async function SpecialistsPage() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  const t = m.specialists;
  const header = (
    <>
      <Link href="/assistant" className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t.back}
      </Link>
      <PageHeader title={t.title} description={t.desc} />
    </>
  );

  if (await locked("agent")) {
    return (
      <>
        {header}
        <Card className="flex items-center gap-3 p-5 text-[0.875rem]">
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {t.errors.edition}
        </Card>
      </>
    );
  }
  const store = getSpecialistStore();
  if (!(await store.supports())) {
    return (
      <>
        {header}
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-[0.875rem] leading-relaxed">{t.pending}</p>
      </>
    );
  }

  const [specialists, available] = await Promise.all([store.list(await getUserKey()), getEdition().then(availableSpecialistTools)]);
  // Each tool as the owner reads it: its name in their language, and what it can do.
  const tools: ToolChoice[] = available.map((tool) => {
    const c = getCapability(tool.capability);
    return {
      name: tool.spec.name,
      label: c ? (locale === "fr" ? c.labelFr : c.label) : tool.spec.name,
      kind: c?.tier === "safe" ? "safe" : c?.tier === "low" ? "low" : "ask",
    };
  });
  const names = new Set(tools.map((x) => x.name));
  const templates = TEMPLATES.map((tpl) => ({ id: tpl.id, ...fromTemplate(tpl, locale, names) }));

  return (
    <>
      {header}
      <SpecialistsManager specialists={specialists} tools={tools} templates={templates} max={SPECIALIST_LIMITS.count} />
    </>
  );
}
