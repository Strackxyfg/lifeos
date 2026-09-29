"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { startSso, type SsoState } from "@/app/actions/sso";
import { useMessages } from "@/lib/i18n/client";

const initial: SsoState = { ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background transition-[transform,filter] duration-200 hover:brightness-95 active:scale-[0.985] disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
      {!pending && <ArrowRight className="h-4 w-4" />}
    </button>
  );
}

/** Single sign-on: a work address in, the company's sign-in page out. */
export function SsoForm({ next, error }: { next?: string; error?: string }) {
  const m = useMessages();
  const s = m.auth.sso;
  const [state, formAction] = useActionState(startSso.bind(null, next), initial);
  // A failure on the way back (the callback) arrives in the address; one here, in the state.
  const code = state.code ?? (error ? (error in s.errors ? error : "failed") : undefined);

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-h2 tracking-tight">{s.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{s.sub}</p>
      </div>

      <form action={formAction} className="space-y-3">
        <input
          // Remounted with what was typed after a refusal: React empties a form once its action ran.
          key={state.email ?? ""}
          defaultValue={state.email}
          type="text"
          name="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          aria-label={s.email}
          className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-border-strong focus:ring-2 focus:ring-ring/50"
        />
        {code && (
          <p role="alert" className="text-[0.8125rem] text-danger">
            {s.errors[code as keyof typeof s.errors]}
          </p>
        )}
        <Submit label={s.submit} />
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-foreground underline-offset-4 hover:underline">
          {s.back}
        </Link>
      </p>
    </div>
  );
}
