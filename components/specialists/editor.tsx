"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { areaCls, Field, inputCls } from "@/components/sales/fields";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { DEPTHS, SPECIALIST_LIMITS, type Depth } from "@/lib/specialists/constants";
import type { SpecialistInput } from "@/lib/specialists/model";
import { saveSpecialist } from "@/app/actions/specialists";

export interface ToolChoice {
  name: string;
  label: string;
  /** safe: reads; low: writes in LifeOS; ask: may need the owner's approval. */
  kind: "safe" | "low" | "ask";
}

const KIND_TONE = { safe: "text-success", low: "text-accent", ask: "text-warning" } as const;

/** A specialist, new or edited: its role, its tools, its depth — saved only when the owner says so. */
export function SpecialistEditor({ id, initial, tools, notice, onDone }: { id: string | null; initial: SpecialistInput; tools: ToolChoice[]; notice?: string; onDone: (saved: boolean) => void }) {
  const t = useMessages().specialists;
  const f = t.fields;
  const [v, setV] = useState<SpecialistInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const err = (k: string) => (error?.field === k ? error.text : null);
  const toggle = (name: string) => setV((s) => ({ ...s, tools: s.tools.includes(name as never) ? s.tools.filter((x) => x !== name) : [...s.tools, name as never] }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let r: Awaited<ReturnType<typeof saveSpecialist>> | null = null;
    try {
      r = await saveSpecialist(id, v);
    } catch {
      setBusy(false);
      return toast(t.errors.network, "error");
    }
    setBusy(false);
    if (r.ok) {
      toast(t.saved);
      return onDone(true);
    }
    const field = r.code === "invalid" ? (r.field ?? "") : r.code === "taken" ? "name" : "";
    const max = SPECIALIST_LIMITS[field as keyof typeof SPECIALIST_LIMITS];
    const text =
      r.code === "invalid" && field in t.fieldErrors
        ? fill(t.fieldErrors[field as keyof typeof t.fieldErrors], { max: max ?? "" })
        : fill(t.errors[r.code], { max: SPECIALIST_LIMITS.count });
    setError({ field, text });
    if (!field) toast(text, "error");
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-5" noValidate>
      {notice && <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[0.8125rem] leading-relaxed">{notice}</p>}
      <Field label={f.name} error={err("name")}>
        {(p) => <input {...p} value={v.name} maxLength={SPECIALIST_LIMITS.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputCls} data-autofocus />}
      </Field>
      <Field label={f.description} hint={f.descriptionHint} error={err("description")}>
        {(p) => <textarea {...p} rows={2} value={v.description} maxLength={SPECIALIST_LIMITS.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={areaCls} />}
      </Field>
      <Field label={f.instructions} hint={f.instructionsHint} error={err("instructions")}>
        {(p) => <textarea {...p} rows={10} value={v.instructions} maxLength={SPECIALIST_LIMITS.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} className={cn(areaCls, "leading-relaxed")} />}
      </Field>

      <fieldset>
        <legend className="text-[0.8125rem] text-muted-foreground">{f.tools}</legend>
        <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{f.toolsHint}</p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {tools.map((tool) => (
            <label key={tool.name} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[0.8125rem] transition-colors", v.tools.includes(tool.name as never) ? "border-border-strong bg-surface-2" : "border-border hover:bg-surface-2/50")}>
              <input type="checkbox" checked={v.tools.includes(tool.name as never)} onChange={() => toggle(tool.name)} className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block leading-snug">{tool.label}</span>
                <span className={cn("text-[0.7rem]", KIND_TONE[tool.kind])}>{t.tiers[tool.kind]}</span>
              </span>
            </label>
          ))}
        </div>
        {v.tools.length === 0 && <p className="mt-1.5 text-[0.72rem] text-muted">{f.toolsNone}</p>}
        {err("tools") && <p className="mt-1.5 text-[0.75rem] text-danger">{err("tools")}</p>}
        <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">{t.delegatedNote}</p>
      </fieldset>

      <fieldset>
        <legend className="text-[0.8125rem] text-muted-foreground">{f.depth}</legend>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label={f.depth}>
          {DEPTHS.map((d: Depth) => (
            <label key={d} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-md border px-2.5 py-2 text-[0.8125rem]", v.depth === d ? "border-border-strong bg-surface-2" : "border-border hover:bg-surface-2/50")}>
              <span className="flex items-center gap-2">
                <input type="radio" name="depth" value={d} checked={v.depth === d} onChange={() => setV({ ...v, depth: d })} className="h-4 w-4" />
                {t.depths[d]}
              </span>
              <span className="text-[0.72rem] leading-snug text-muted">{t.depthHints[d]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(false)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t.cancel}
        </button>
        <button type="submit" disabled={busy} className={buttonVariants({ size: "sm" })}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {busy ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}
