import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SwitchEdition } from "@/components/plans/switch-edition";
import { getMessages } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/config";
import { addedBy, type Feature } from "@/lib/plans/editions";
import { getEditionState, locked } from "@/lib/plans/server";
import { cn } from "@/lib/utils";

/**
 * Renders its children when the person's edition opens the feature, and
 * otherwise says which edition does, what it adds, and how to get it.
 *
 * Display only: every write behind these pages checks the edition again on
 * the server.
 */
export async function EditionGate({ feature, children }: { feature: Feature; children: React.ReactNode }) {
  const needed = await locked(feature);
  if (!needed) return <>{children}</>;

  const [m, state] = await Promise.all([getMessages(), getEditionState()]);
  const t = m.editions;
  const name = t.names[needed];

  return (
    <Card className="mx-auto mt-6 max-w-xl p-6 sm:p-8">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface-2 text-muted-foreground">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-medium tracking-tight">{fill(t.lockedTitle, { feature: t.features[feature], edition: name })}</h1>
      <p className="mt-2 text-[0.875rem] text-muted-foreground">{fill(t.lockedBody, { current: t.names[state.edition], edition: name })}</p>
      <ul className="mt-3 space-y-1.5 text-[0.875rem]">
        {addedBy(needed).map((f) => (
          <li key={f} className={cn("flex gap-2", f === feature ? "text-foreground" : "text-muted-foreground")}>
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> {t.features[f]}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[0.8125rem] text-muted-foreground">{state.billing ? t.lockedBilling : t.lockedEarly}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {!state.billing && <SwitchEdition edition={needed} />}
        <Link href="/billing#editions" className={buttonVariants({ variant: state.billing ? "accent" : "secondary", size: "md" })}>
          {t.seeEditions}
        </Link>
      </div>
    </Card>
  );
}
