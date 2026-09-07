"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateProfile, type ProfileState } from "@/app/actions/profile";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const initial: ProfileState = { ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function SettingsProfileForm({
  name,
  email,
  profession,
}: {
  name: string;
  email: string;
  profession: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(updateProfile, initial);
  const lastAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    toast(state.message ?? (state.ok ? "Saved" : "Error"), state.ok ? "success" : "error");
    if (state.ok) router.refresh(); // re-render the server layout → sidebar/greeting update
  }, [state, router]);

  return (
    <form action={action} className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="Name" name="name" defaultValue={name} />
      <Field label="Email" defaultValue={email} disabled />
      <Field label="Profession" name="profession" defaultValue={profession} />
      <Field label="Timezone" defaultValue="America/Los_Angeles" disabled />
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
}: {
  label: string;
  name?: string;
  defaultValue: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8125rem] text-muted-foreground">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-border bg-surface-2/40 px-3 text-sm outline-none transition-colors focus:border-border-strong focus:ring-2 focus:ring-ring/50 disabled:opacity-60"
      />
    </label>
  );
}
