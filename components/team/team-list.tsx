"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Loader2, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { createTeam } from "@/app/actions/team";
import { toast } from "@/components/ui/toaster";
import type { TeamListItem } from "@/lib/team/view";
import type { TeamKind } from "@/lib/team/rules";

export function TeamList({ teams, available, suggestedName }: { teams: TeamListItem[]; available: boolean; suggestedName: string }) {
  const m = useMessages();
  const t = m.team;
  const locale = useLocale();

  if (!available) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">{t.errors.migration_pending}</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-3">
        <Card>
          <CardHeader title={t.list.yours} />
          {teams.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">{t.list.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {teams.map((team) => (
                <li key={team.id}>
                  <Link href={`/team/${team.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2/40">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                      {team.kind === "circle" ? <UsersRound className="h-5 w-5" aria-hidden /> : <Building2 className="h-5 w-5" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{team.name}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">
                        {t.kinds[team.kind]} · {plural(locale, team.members, t.members)} · {t.roles[team.role]}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="flex items-start gap-2 px-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          {t.privacy}
        </p>
      </div>
      <div className="lg:col-span-2">
        <CreateTeam suggestedName={suggestedName} />
      </div>
    </div>
  );
}

function CreateTeam({ suggestedName }: { suggestedName: string }) {
  const m = useMessages();
  const t = m.team;
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TeamKind>("company");
  const [me, setMe] = useState(suggestedName);
  const [seats, setSeats] = useState(10);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const res = await createTeam({ name, kind, displayName: me, seats });
    setBusy(false);
    if (!res.ok) {
      toast(t.errors[res.code], "error");
      return;
    }
    router.push(`/team/${res.data.id}`);
  };

  const field = "mt-1 h-10 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-accent/60";
  return (
    <Card>
      <CardHeader title={t.create.title} />
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        <fieldset>
          <legend className="text-[0.8125rem] text-muted-foreground">{t.create.kind}</legend>
          <div className="mt-1.5 grid gap-2">
            {(["company", "circle"] as TeamKind[]).map((k) => (
              <label
                key={k}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
                  kind === k ? "border-accent/60 bg-accent/10" : "border-border hover:bg-surface-2/40"
                )}
              >
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1 accent-[hsl(var(--accent))]" />
                <span>
                  <span className="block text-sm font-medium">{t.kinds[k]}</span>
                  <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{t.kindsHelp[k]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-[0.8125rem] text-muted-foreground">
          {t.create.name}
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.create.namePlaceholder} className={field} />
        </label>
        <label className="block text-[0.8125rem] text-muted-foreground">
          {t.create.displayName}
          <input required maxLength={80} value={me} onChange={(e) => setMe(e.target.value)} className={field} />
        </label>
        <label className="block text-[0.8125rem] text-muted-foreground">
          {t.create.seats}
          <input
            type="number"
            min={1}
            max={10000}
            value={seats}
            onChange={(e) => setSeats(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
            className={field}
          />
          <span className="mt-1 block text-[0.75rem] text-muted">{t.create.seatsHelp}</span>
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim() || !me.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t.create.submit}
        </button>
      </form>
    </Card>
  );
}

export function JoinCard({
  token,
  preview,
  suggestedName,
}: {
  token: string;
  preview: { state: string; team: { id: string; name: string; kind: TeamKind; members: number } | null };
  suggestedName: string;
}) {
  const m = useMessages();
  const t = m.team;
  const locale = useLocale();
  const router = useRouter();
  const [me, setMe] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const { state, team } = preview;

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { acceptInvite } = await import("@/app/actions/team");
    const res = await acceptInvite(token, me);
    setBusy(false);
    if (!res.ok) {
      toast(t.errors[res.code], "error");
      router.refresh();
      return;
    }
    router.push(`/team/${res.data.teamId}`);
  };

  return (
    <Card className="mx-auto max-w-md p-6">
      {team ? (
        <>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent">
            {team.kind === "circle" ? <UsersRound className="h-6 w-6" aria-hidden /> : <Building2 className="h-6 w-6" aria-hidden />}
          </span>
          <h1 className="mt-4 text-xl font-medium tracking-tight">{fill(t.join.title, { team: team.name })}</h1>
          <p className="text-sm text-muted-foreground">
            {fill(t.join.kindLine, { kind: t.kinds[team.kind], members: plural(locale, team.members, t.members) })}
          </p>
        </>
      ) : null}
      {state === "ok" ? (
        <form onSubmit={join} className="mt-5 space-y-3">
          <label className="block text-[0.8125rem] text-muted-foreground">
            {t.join.displayName}
            <input
              required
              maxLength={80}
              value={me}
              onChange={(e) => setMe(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-accent/60"
            />
          </label>
          <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            {t.privacy}
          </p>
          <button
            type="submit"
            disabled={busy || !me.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t.join.submit}
          </button>
        </form>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{t.join.states[state as keyof typeof t.join.states] ?? t.join.states.invalid}</p>
          {state === "sso" && (
            <Link
              href={`/login/sso?next=${encodeURIComponent(`/join/${token}`)}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
            >
              <Building2 className="h-4 w-4" aria-hidden />
              {m.auth.sso.link}
            </Link>
          )}
          {state === "member" && team && (
            <Link href={`/team/${team.id}`} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
              {t.join.open} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
