"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Crown, Link2, LogOut, Shield, Trash2, UserMinus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { canInvite, canRemove, roleChange, type Role } from "@/lib/team/rules";
import type { TeamPageView } from "@/lib/team/view";
import {
  createInvite,
  deleteTeam,
  leaveTeam,
  removeMember,
  revokeInvite,
  setMemberRole,
  updateMyself,
  updateTeam,
} from "@/app/actions/team";
import { toast } from "@/components/ui/toaster";
import { useTeamAction } from "./use-team-action";

const input = "w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-accent/60";

export function TeamMembers({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const locale = useLocale();
  const router = useRouter();
  const { run, pending } = useTeamAction();
  const me = { key: view.me.id, role: view.me.role };
  const manage = view.me.role === "owner" || view.me.role === "admin";

  // Buttons follow the same rules the database enforces; it still has the last word.
  const actionsFor = (x: TeamPageView["members"][number]) => {
    const target = { key: x.id, role: x.role };
    const out: { label: string; icon: typeof Shield; act: () => void; danger?: boolean }[] = [];
    if (roleChange(me, target, "admin").ok && x.role === "member") {
      out.push({ label: t.manage.makeAdmin, icon: Shield, act: () => void run(() => setMemberRole(view.team.id, x.id, "admin")) });
    }
    if (roleChange(me, target, "member").ok && x.role === "admin") {
      out.push({ label: t.manage.makeMember, icon: Shield, act: () => void run(() => setMemberRole(view.team.id, x.id, "member")) });
    }
    if (roleChange(me, target, "owner").ok) {
      out.push({
        label: t.manage.handOver,
        icon: Crown,
        act: () => {
          if (confirm(fill(t.manage.handOverConfirm, { name: x.name }))) void run(() => setMemberRole(view.team.id, x.id, "owner"));
        },
      });
    }
    if (!x.me && canRemove(me, target)) {
      out.push({
        label: t.manage.remove,
        icon: UserMinus,
        danger: true,
        act: () => {
          if (confirm(fill(t.manage.removeConfirm, { name: x.name }))) void run(() => removeMember(view.team.id, x.id));
        },
      });
    }
    return out;
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-3">
        <Card>
          <CardHeader
            title={
              <span>
                {t.tabs.members} <span className="font-normal text-muted-foreground">· {fill(t.seatsOf, { n: view.team.members, seats: view.team.seats })}</span>
              </span>
            }
          />
          <ul className="divide-y divide-border">
            {view.members.map((x) => {
              const acts = actionsFor(x);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.75rem] font-medium" aria-hidden>
                    {x.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {x.name} {x.me && <span className="font-normal text-muted-foreground">({t.manage.you})</span>}
                    </p>
                    <p className="truncate text-[0.75rem] text-muted-foreground">
                      {[t.roles[x.role], x.title].filter(Boolean).join(" · ")}
                      {x.sso && <span className="ml-1.5 rounded bg-accent/15 px-1 py-px text-[0.65rem] font-medium text-accent">{t.manage.ssoBadge}</span>}
                    </p>
                  </div>
                  {acts.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {acts.map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          disabled={pending}
                          onClick={a.act}
                          className={cn(
                            "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[0.75rem] text-muted-foreground transition-colors",
                            a.danger ? "hover:border-danger/50 hover:text-danger" : "hover:text-foreground"
                          )}
                        >
                          <a.icon className="h-3.5 w-3.5" aria-hidden />
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {manage && <Invites view={view} />}
      </div>

      <div className="space-y-3 lg:col-span-2">
        <Myself view={view} />
        {manage && <Seats view={view} />}
        {view.me.role !== "owner" ? (
          <button
            type="button"
            onClick={async () => {
              if (!confirm(t.manage.leaveConfirm)) return;
              const res = await leaveTeam(view.team.id);
              if (!res.ok) return toast(t.errors[res.code], "error");
              router.push("/team?all=1");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:border-danger/50 hover:text-danger"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t.manage.leave}
          </button>
        ) : (
          <DeleteTeam view={view} />
        )}
        <p className="px-1 text-[0.75rem] text-muted">{plural(locale, view.team.members, t.members)}</p>
      </div>
    </div>
  );
}

function Invites({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const locale = useLocale();
  const { run, pending } = useTeamAction();
  const [role, setRole] = useState<Role>("member");
  const [uses, setUses] = useState(5);
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });

  const create = async () => {
    const data = await run(() => createInvite(view.team.id, { role, maxUses: uses, days }));
    if (data) {
      setLink(`${window.location.origin}/join/${data.token}`);
      setCopied(false);
    }
  };

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-accent" aria-hidden />{t.manage.invite}</span>} />
      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[0.75rem] text-muted-foreground">
            {t.manage.role}
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={cn(input, "mt-1 h-9 px-2")}>
              <option value="member">{t.roles.member}</option>
              {canInvite(view.me.role, "admin") && <option value="admin">{t.roles.admin}</option>}
            </select>
          </label>
          <label className="text-[0.75rem] text-muted-foreground">
            {t.manage.uses}
            <select value={uses} onChange={(e) => setUses(Number(e.target.value))} className={cn(input, "mt-1 h-9 px-2")}>
              {[1, 5, 25, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[0.75rem] text-muted-foreground">
            {t.manage.days}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={cn(input, "mt-1 h-9 px-2")}>
              {[1, 7, 30].map((n) => (
                <option key={n} value={n}>
                  {plural(locale, n, t.manage.daysValue)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" disabled={pending} onClick={() => void create()} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50">
          {t.manage.create}
        </button>
        {link && (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
            <p className="text-[0.75rem] font-medium">{t.manage.link}</p>
            <div className="mt-1.5 flex gap-2">
              <input readOnly value={link} onFocus={(e) => e.target.select()} className={cn(input, "h-9 font-mono text-[0.75rem]")} />
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(link).catch(() => {});
                  setCopied(true);
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.8125rem]"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t.manage.copied : t.manage.copy}
              </button>
            </div>
            <p className="mt-1.5 text-[0.72rem] text-muted-foreground">{t.manage.once}</p>
          </div>
        )}
        {view.invites.length > 0 && (
          <div>
            <p className="text-[0.75rem] font-medium text-muted-foreground">{t.manage.active}</p>
            <ul className="mt-1 divide-y divide-border">
              {view.invites.map((i) => {
                const expired = Date.parse(i.expiresAt) < Date.now();
                return (
                  <li key={i.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                    <span className="flex-1">
                      {t.roles[i.role]} · {fill(t.manage.usage, { uses: i.uses, max: i.maxUses, date: date(i.expiresAt) })}
                      <span className="text-muted"> · {i.createdByName}</span>
                    </span>
                    {i.revoked ? (
                      <span className="text-muted">{t.manage.revoked}</span>
                    ) : expired ? (
                      <span className="text-muted">{t.manage.expired}</span>
                    ) : (
                      <button type="button" disabled={pending} onClick={() => void run(() => revokeInvite(view.team.id, i.id))} className="text-muted-foreground hover:text-danger">
                        {t.manage.revoke}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Myself({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const { run, pending } = useTeamAction();
  const [name, setName] = useState(view.me.name);
  const [title, setTitle] = useState(view.me.title ?? "");
  return (
    <Card>
      <CardHeader title={t.manage.me} />
      <form
        className="space-y-2.5 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateMyself(view.team.id, { displayName: name, title: title || null }));
        }}
      >
        <label className="block text-[0.75rem] text-muted-foreground">
          {t.manage.name}
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={cn(input, "mt-1 h-9")} />
        </label>
        <label className="block text-[0.75rem] text-muted-foreground">
          {t.manage.jobTitle}
          <input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className={cn(input, "mt-1 h-9")} />
        </label>
        <button type="submit" disabled={pending || !name.trim()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
          {t.manage.save}
        </button>
      </form>
    </Card>
  );
}

function Seats({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const { run, pending } = useTeamAction();
  const [seats, setSeats] = useState(view.team.seats);
  return (
    <Card className="p-5">
      <label className="block text-[0.8125rem] text-muted-foreground">
        {t.manage.seats}
        <div className="mt-1 flex gap-2">
          <input
            type="number"
            min={view.team.members}
            max={10000}
            value={seats}
            onChange={(e) => setSeats(Math.max(view.team.members, Math.min(10000, Number(e.target.value) || view.team.members)))}
            className={cn(input, "h-9")}
          />
          <button
            type="button"
            disabled={pending || seats === view.team.seats}
            onClick={() => void run(() => updateTeam(view.team.id, { seats }))}
            className="shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            {t.manage.save}
          </button>
        </div>
      </label>
      <p className="mt-1.5 text-[0.75rem] text-muted">{fill(t.seatsOf, { n: view.team.members, seats: view.team.seats })}</p>
    </Card>
  );
}

function DeleteTeam({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const t = m.team;
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="border-danger/30 p-5">
      <p className="text-sm font-medium text-danger">{t.manage.danger}</p>
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t.manage.dangerHelp}</p>
      <div className="mt-3 flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={view.team.name} aria-label={t.manage.danger} className={cn(input, "h-9")} />
        <button
          type="button"
          disabled={busy || typed.trim() !== view.team.name}
          onClick={async () => {
            setBusy(true);
            const res = await deleteTeam(view.team.id, typed);
            setBusy(false);
            if (!res.ok) return toast(t.errors[res.code], "error");
            router.push("/team?all=1");
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-white disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t.manage.delete}
        </button>
      </div>
    </Card>
  );
}
