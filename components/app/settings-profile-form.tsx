"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { updateProfile, type ProfileState } from "@/app/actions/profile";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { AREA_IDS, LIMITS, type AreaId } from "@/lib/onboarding";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const initial: ProfileState = { ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  const m = useMessages();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {pending ? m.settings.saving : m.settings.save}
    </button>
  );
}

export function SettingsProfileForm({
  name,
  email,
  profession,
  areas,
}: {
  name: string;
  email: string;
  profession: string;
  areas: AreaId[];
}) {
  const m = useMessages();
  const t = m.settings;
  const router = useRouter();
  const [state, action] = useActionState(updateProfile, initial);
  const lastAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    toast(state.ok ? t.saved : t.errors[state.code ?? "failed"], state.ok ? "success" : "error");
    if (state.ok) router.refresh(); // re-render the server layout → sidebar and greeting follow
  }, [state, router, t]);

  return (
    <form action={action} className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label={t.name} name="name" defaultValue={name} maxLength={LIMITS.name} required />
      <Field label={t.email} defaultValue={email} disabled />
      <div className="sm:col-span-2">
        <Field label={t.profession} name="profession" defaultValue={profession} maxLength={LIMITS.profession} />
      </div>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 block text-[0.8125rem] text-muted-foreground">{t.areas}</legend>
        <div className="flex flex-wrap gap-2">
          {AREA_IDS.map((id) => (
            <label key={id} className="cursor-pointer">
              {/* A real checkbox, so the form posts every ticked area. */}
              <input type="checkbox" name="areas" value={id} defaultChecked={areas.includes(id)} className="peer sr-only" />
              <span className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:border-border-strong peer-checked:border-accent/50 peer-checked:bg-accent/10 peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 [&>svg]:hidden peer-checked:[&>svg]:block">
                <Check className="h-3 w-3 text-accent" />
                {m.onboarding.areas[id]}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[0.72rem] text-muted-foreground">{t.areasHint}</p>
      </fieldset>

      <div className="sm:col-span-2">
        <SaveButton />
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  disabled,
  maxLength,
  required,
}: {
  label: string;
  name?: string;
  defaultValue: string;
  disabled?: boolean;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8125rem] text-muted-foreground">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        maxLength={maxLength}
        required={required}
        className="h-10 w-full rounded-lg border border-border bg-surface-2/40 px-3 text-sm outline-none transition-colors focus:border-border-strong focus:ring-2 focus:ring-ring/50 disabled:opacity-60"
      />
    </label>
  );
}
