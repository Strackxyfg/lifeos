"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Pencil, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Modal } from "@/components/maps/modal";
import { areaCls } from "@/components/sales/fields";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { Specialist, SpecialistInput } from "@/lib/specialists/model";
import { deleteSpecialist, proposeSpecialistDraft } from "@/app/actions/specialists";
import { SpecialistEditor, type ToolChoice } from "./editor";

export type { ToolChoice } from "./editor";

type Editing = { id: string | null; initial: SpecialistInput; notice?: string; title: string };

const BLANK: SpecialistInput = { name: "", description: "", instructions: "", tools: [], depth: "balanced" };

/** The owner's specialists: describe a need and get one proposed, start from a model or from nothing, edit, remove. */
export function SpecialistsManager({ specialists, tools, templates, max }: { specialists: Specialist[]; tools: ToolChoice[]; templates: (SpecialistInput & { id: string })[]; max: number }) {
  const t = useMessages().specialists;
  const locale = useLocale();
  const router = useRouter();
  const [need, setNeed] = useState("");
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<Specialist | null>(null);
  const [busy, setBusy] = useState(false);
  const full = specialists.length >= max;

  const propose = async () => {
    if (need.trim().length < 3) return;
    setProposing(true);
    try {
      const r = await proposeSpecialistDraft(need, locale);
      if (r.ok) setEditing({ id: null, initial: r.data, notice: t.create.proposed, title: t.newTitle });
      else toast(t.errors[r.code], "error");
    } catch {
      toast(t.errors.network, "error");
    } finally {
      setProposing(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await deleteSpecialist(removing.id);
      if (r.ok) {
        toast(t.deleted);
        router.refresh();
      } else toast(t.errors[r.code], "error");
    } catch {
      toast(t.errors.network, "error");
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <>
      {!full && (
        <Card className="mb-4 p-5">
          <label htmlFor="specialist-need" className="flex items-center gap-2 text-[0.9375rem] font-medium">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            {t.create.describe}
          </label>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t.create.hint}</p>
          <textarea
            id="specialist-need"
            rows={3}
            value={need}
            maxLength={1000}
            onChange={(e) => setNeed(e.target.value)}
            placeholder={t.create.placeholder}
            className={cn(areaCls, "mt-3 leading-relaxed")}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setEditing({ id: null, initial: BLANK, title: t.newTitle })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t.create.blank}
            </button>
            <button type="button" onClick={propose} disabled={proposing || need.trim().length < 3} className={buttonVariants({ size: "sm" })}>
              {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              {proposing ? t.create.proposing : t.create.propose}
            </button>
          </div>

          <p className="mt-5 text-[0.8125rem] text-muted-foreground">{t.create.models}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setEditing({ id: null, initial: { name: tpl.name, description: tpl.description, instructions: tpl.instructions, tools: tpl.tools, depth: tpl.depth }, title: t.newTitle })}
                className="rounded-lg border border-border bg-surface-2/30 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <span className="block text-[0.875rem] font-medium">{tpl.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-[0.75rem] leading-snug text-muted-foreground">{tpl.description}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[0.875rem] font-semibold">{t.title}</h2>
        <span className={cn("text-[0.75rem]", full ? "text-warning" : "text-muted")}>{fill(t.count, { n: specialists.length, max })}</span>
      </div>
      {full && <p className="mb-3 text-[0.8125rem] text-warning">{fill(t.errors.full, { max })}</p>}

      {specialists.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={t.emptyTitle} description={t.emptyBody} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {specialists.map((s) => (
            <Card key={s.id} className="flex flex-col p-4">
              <p className="text-[0.9375rem] font-medium">{s.name}</p>
              <p className="mt-1 flex-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{s.description}</p>
              <p className="mt-2 text-[0.72rem] text-muted">
                {plural(locale, s.tools.length, t.tools)} · {t.depths[s.depth]}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/assistant?specialist=${encodeURIComponent(s.id)}`} className={buttonVariants({ size: "sm" })}>
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  {t.talk}
                </Link>
                <button
                  type="button"
                  onClick={() => setEditing({ id: s.id, initial: { name: s.name, description: s.description, instructions: s.instructions, tools: s.tools, depth: s.depth }, title: fill(t.editTitle, { name: s.name }) })}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {t.edit}
                </button>
                <button type="button" onClick={() => setRemoving(s)} aria-label={`${t.delete} — ${s.name}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hover:text-danger")}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t.delete}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.title ?? t.newTitle} closeLabel={t.close} wide>
        {editing && (
          <SpecialistEditor
            id={editing.id}
            initial={editing.initial}
            tools={tools}
            notice={editing.notice}
            onDone={(saved) => {
              setEditing(null);
              if (saved) {
                setNeed("");
                router.refresh();
              }
            }}
          />
        )}
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={fill(t.deleteTitle, { name: removing?.name ?? "" })} closeLabel={t.close}>
        <div className="space-y-4 p-5">
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">{t.deleteBody}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRemoving(null)} className={buttonVariants({ variant: "ghost", size: "sm" })} data-autofocus>
              {t.cancel}
            </button>
            <button type="button" onClick={remove} disabled={busy} className={cn(buttonVariants({ size: "sm" }), "bg-danger text-white hover:bg-danger/90")}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
              {t.delete}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
