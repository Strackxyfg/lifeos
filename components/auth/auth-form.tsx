"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";
import { authenticate, type AuthState } from "@/app/actions/auth";
import { useMessages } from "@/lib/i18n/client";

const initial: AuthState = { ok: false };

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

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const m = useMessages();
  const action = authenticate.bind(null, mode);
  const [state, formAction] = useActionState(action, initial);

  useEffect(() => {
    if (state.ok) {
      router.push(next || (mode === "signup" ? "/onboarding" : "/dashboard"));
      router.refresh();
    }
  }, [state.ok, mode, next, router]);

  const isSignup = mode === "signup";

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-h2 tracking-tight">{isSignup ? m.auth.signUpTitle : m.auth.signInTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{isSignup ? m.auth.signUpSub : m.auth.signInSub}</p>
      </div>

      <button className="mb-4 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface text-sm font-medium transition-colors hover:border-border-strong">
        <GoogleMark />
        {m.auth.google}
      </button>

      <div className="mb-4 flex items-center gap-3 text-[0.75rem] text-muted">
        <span className="h-px flex-1 bg-border" /> {m.auth.or} <span className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="space-y-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@work.com"
          aria-label="Email"
          className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-border-strong focus:ring-2 focus:ring-ring/50"
        />
        <input
          type="password"
          name="password"
          required
          placeholder={m.auth.passwordPh}
          aria-label={m.auth.passwordPh}
          className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-border-strong focus:ring-2 focus:ring-ring/50"
        />
        {state.message && <p className="text-[0.8125rem] text-danger">{state.message}</p>}
        <Submit label={isSignup ? m.auth.createAccount : m.auth.signIn} />
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignup ? (
          <>
            {m.auth.haveAccount}{" "}
            <Link href="/login" className="text-foreground underline-offset-4 hover:underline">{m.auth.signInLink}</Link>
          </>
        ) : (
          <>
            {m.auth.noAccount}{" "}
            <Link href="/signup" className="text-foreground underline-offset-4 hover:underline">{m.auth.createLink}</Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1a6.2 6.2 0 1 1 0-12.4c1.77 0 2.96.76 3.64 1.4l2.48-2.4A9.6 9.6 0 0 0 12 2a10 10 0 1 0 0 20c5.77 0 9.6-4.05 9.6-9.76 0-.66-.07-1.16-.16-1.66H12z" />
    </svg>
  );
}
