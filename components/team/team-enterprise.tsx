"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, Copy, Globe, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { EnterpriseView, TeamPageView } from "@/lib/team/view";
import {
  claimDomain,
  connectSso,
  createScimToken,
  disconnectSso,
  removeDomain,
  revokeScimToken,
  setGroupRole,
  setSsoOptions,
  verifyDomain,
  type EnterpriseResult,
} from "@/app/actions/enterprise";

const input = "w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-accent/60";

/** Runs an enterprise action: a toast in the person's language when refused, then the page re-read. */
function useEnterpriseAction() {
  const m = useMessages();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: () => Promise<EnterpriseResult<T>>, success?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await action();
        if (!res.ok) {
          toast(fill(m.team.enterprise.errors[res.code], { detail: res.detail ?? "" }), "error");
          return null;
        }
        if (success) toast(success);
        start(() => router.refresh());
        return res.data;
      } finally {
        setBusy(false);
      }
    },
    [m, router]
  );
  return { run, pending: pending || busy };
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const m = useMessages();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[0.72rem] text-muted-foreground">{label}</p>
      <div className="mt-1 flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} className={cn(input, "h-8 text-[0.75rem]", mono && "font-mono")} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          aria-label={`${m.team.manage.copy} — ${label}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function Toggle({ checked, disabled, onChange, label, help }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; help: string }) {
  return (
    <label className={cn("flex items-start gap-3", disabled && "opacity-60")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]" />
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-[0.75rem] text-muted-foreground">{help}</span>
      </span>
    </label>
  );
}

/**
 * A company's enterprise settings: its verified domains, single sign-on
 * and automatic provisioning. The owner changes them; admins see them.
 */
export function TeamEnterprise({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const e = view.enterprise;
  if (!e) return null;
  const t = m.team.enterprise;
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        {e.owner ? t.intro : `${t.intro} ${t.ownerOnly}`}
      </p>
      {!e.available ? (
        <Card className="p-5 text-sm text-muted-foreground">{t.errors.migration_pending}</Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <Domains teamId={view.team.id} e={e} />
            <Scim teamId={view.team.id} e={e} />
          </div>
          <Sso teamId={view.team.id} e={e} />
        </div>
      )}
    </div>
  );
}

function Domains({ teamId, e }: { teamId: string; e: EnterpriseView }) {
  const m = useMessages();
  const t = m.team.enterprise.domains;
  const { run, pending } = useEnterpriseAction();
  const [domain, setDomain] = useState("");
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Globe className="h-4 w-4 text-accent" aria-hidden />{t.title}</span>} />
      <div className="space-y-3 px-5 py-4">
        <p className="text-[0.8125rem] text-muted-foreground">{t.help}</p>
        {e.domains.length === 0 && <p className="text-[0.8125rem] text-muted">{t.none}</p>}
        <ul className="space-y-2">
          {e.domains.map((d) => (
            <li key={d.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{d.domain}</span>
                {d.verified ? (
                  <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[0.7rem] text-success">
                    <BadgeCheck className="h-3 w-3" aria-hidden />
                    {t.verified}
                  </span>
                ) : (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[0.7rem] text-warning">{t.pending}</span>
                )}
                {e.owner && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(fill(t.removeConfirm, { domain: d.domain }))) void run(() => removeDomain(teamId, d.id));
                    }}
                    className="ml-auto text-[0.75rem] text-muted-foreground hover:text-danger"
                  >
                    {t.remove}
                  </button>
                )}
              </div>
              {!d.verified && e.owner && (
                <div className="mt-3 space-y-2">
                  <p className="text-[0.75rem] text-muted-foreground">{t.record}</p>
                  <CopyField label={t.name} value={d.record.name} />
                  <CopyField label={t.value} value={d.record.value} />
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void run(() => verifyDomain(teamId, d.id), fill(t.verifiedToast, { domain: d.domain }))}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-accent-foreground disabled:opacity-50"
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      {t.verify}
                    </button>
                    <span className="text-[0.72rem] text-muted">{t.propagation}</span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {e.owner && (
          <form
            className="flex gap-2"
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (await run(() => claimDomain(teamId, domain))) setDomain("");
            }}
          >
            <input value={domain} onChange={(ev) => setDomain(ev.target.value)} placeholder={t.placeholder} aria-label={t.add} maxLength={300} className={cn(input, "h-9")} />
            <button type="submit" disabled={pending || !domain.trim()} className="shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-surface-2 disabled:opacity-50">
              {t.claim}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}

function Sso({ teamId, e }: { teamId: string; e: EnterpriseView }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.team.enterprise.sso;
  const { run, pending } = useEnterpriseAction();
  const [mode, setMode] = useState<"url" | "xml">("url");
  const [url, setUrl] = useState(e.sso?.metadataUrl ?? "");
  const [xml, setXml] = useState("");
  const verified = e.domains.some((d) => d.verified);
  // Everyone but the owner who joined some other way than single sign-on.
  const outsiders = Math.max(0, e.members.total - e.members.viaSso - 1);

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-accent" aria-hidden />{t.title}</span>}
        action={e.sso ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[0.7rem] text-success">{t.connected}</span> : undefined}
      />
      <div className="space-y-4 px-5 py-4">
        <p className="text-[0.8125rem] text-muted-foreground">{t.help}</p>
        {!e.ssoAvailable || !e.sp ? (
          <p className="rounded-xl border border-border bg-surface-2/50 p-3 text-[0.8125rem] text-muted-foreground">{t.unavailable}</p>
        ) : (
          <>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-[0.75rem] font-medium">{t.spTitle}</p>
              <CopyField label={t.entityId} value={e.sp.entityId} />
              <CopyField label={t.acs} value={e.sp.acsUrl} />
              <CopyField label={t.metadata} value={e.sp.metadataUrl} />
              <p className="text-[0.72rem] text-muted-foreground">{t.nameId}</p>
            </div>

            {!verified && !e.sso && <p className="text-[0.8125rem] text-warning">{t.needDomain}</p>}

            {e.owner && (verified || e.sso) && (
              <form
                className="space-y-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void run(() => connectSso(teamId, mode === "url" ? { metadataUrl: url.trim() } : { metadataXml: xml.trim() }), t.connectedToast);
                }}
              >
                {mode === "url" ? (
                  <label className="block text-[0.75rem] text-muted-foreground">
                    {t.metadataUrl}
                    <input type="url" value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder={t.metadataPlaceholder} className={cn(input, "mt-1 h-9 font-mono text-[0.75rem]")} />
                  </label>
                ) : (
                  <textarea value={xml} onChange={(ev) => setXml(ev.target.value)} rows={5} aria-label={t.orXml} placeholder="<EntityDescriptor …>" className={cn(input, "py-2 font-mono text-[0.72rem]")} />
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={pending || (mode === "url" ? !url.trim().startsWith("https://") : xml.trim().length < 20)}
                    className="rounded-lg bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-accent-foreground disabled:opacity-50"
                  >
                    {e.sso ? t.update : t.connect}
                  </button>
                  <button type="button" onClick={() => setMode(mode === "url" ? "xml" : "url")} className="text-[0.75rem] text-muted-foreground underline-offset-4 hover:underline">
                    {mode === "url" ? t.orXml : t.metadataUrl}
                  </button>
                </div>
              </form>
            )}

            {e.sso && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-[0.72rem] text-muted-foreground">
                  {t.provider} <span className="font-mono">{e.sso.providerId}</span>
                </p>
                <p className="text-[0.8125rem]">{fill(t.loginHint, { url: e.loginUrl })}</p>
                <Toggle
                  checked={e.sso.jit}
                  disabled={!e.owner || pending}
                  onChange={(v) => void run(() => setSsoOptions(teamId, { jit: v }))}
                  label={t.jit}
                  help={t.jitHelp}
                />
                <Toggle
                  checked={e.sso.enforce}
                  disabled={!e.owner || pending}
                  onChange={(v) => void run(() => setSsoOptions(teamId, { enforce: v }))}
                  label={t.enforce}
                  help={t.enforceHelp}
                />
                {outsiders > 0 && !e.sso.enforce && <p className="rounded-lg bg-warning/10 p-2.5 text-[0.75rem] text-warning">{plural(locale, outsiders, t.enforceWarning)}</p>}
                {e.owner && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(t.disconnectConfirm)) void run(() => disconnectSso(teamId));
                    }}
                    className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t.disconnect}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Scim({ teamId, e }: { teamId: string; e: EnterpriseView }) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.team.enterprise.scim;
  const { run, pending } = useEnterpriseAction();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-accent" aria-hidden />{t.title}</span>} />
      <div className="space-y-4 px-5 py-4">
        <p className="text-[0.8125rem] text-muted-foreground">{t.help}</p>
        <CopyField label={t.baseUrl} value={e.scimUrl} />

        {e.owner && (
          <div className="space-y-2">
            <p className="text-[0.75rem] font-medium text-muted-foreground">{t.tokens}</p>
            {e.tokens.length === 0 && <p className="text-[0.8125rem] text-muted">{t.none}</p>}
            <ul className="divide-y divide-border">
              {e.tokens.map((k) => (
                <li key={k.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                  <span className="flex-1">
                    {k.label}
                    <span className="text-muted">
                      {" · "}
                      {date(k.createdAt)} · {k.createdByName} · {k.lastUsedAt ? fill(t.lastUsed, { date: date(k.lastUsedAt) }) : t.neverUsed}
                    </span>
                  </span>
                  {k.revoked ? (
                    <span className="text-muted">{t.revoked}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(t.revokeConfirm)) void run(() => revokeScimToken(teamId, k.id));
                      }}
                      className="text-muted-foreground hover:text-danger"
                    >
                      {t.revoke}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={async (ev) => {
                ev.preventDefault();
                const data = await run(() => createScimToken(teamId, label));
                if (data) {
                  setCreated(data.token);
                  setLabel("");
                }
              }}
            >
              <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder={t.labelPlaceholder} aria-label={t.label} maxLength={80} className={cn(input, "h-9")} />
              <button type="submit" disabled={pending || !label.trim()} className="shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-surface-2 disabled:opacity-50">
                {t.create}
              </button>
            </form>
            {created && (
              <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
                <CopyField label={t.label} value={created} />
                <p className="mt-1.5 text-[0.72rem] text-muted-foreground">{t.once}</p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-[0.75rem] font-medium text-muted-foreground">{t.directory}</p>
          <p className="text-sm">
            {e.directory.total === 0
              ? plural(locale, 0, t.counts.total)
              : [plural(locale, e.directory.total, t.counts.total), plural(locale, e.directory.active, t.counts.active), plural(locale, e.directory.linked, t.counts.linked)].join(" · ")}
          </p>
          <p className="text-[0.75rem] font-medium text-muted-foreground">{t.groups}</p>
          <p className="text-[0.72rem] text-muted-foreground">{t.groupsHelp}</p>
          {e.groups.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">{t.noGroups}</p>
          ) : (
            <ul className="divide-y divide-border">
              {e.groups.map((g) => (
                <li key={g.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                  <span className="flex-1">
                    {g.displayName} <span className="text-muted">· {plural(locale, g.members, t.groupMembers)}</span>
                  </span>
                  <label className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                    {t.grants}
                    <select
                      value={g.role}
                      disabled={!e.owner || pending}
                      onChange={(ev) => void run(() => setGroupRole(teamId, g.id, ev.target.value))}
                      className={cn(input, "h-8 w-auto px-2 text-[0.75rem]")}
                    >
                      <option value="member">{m.team.roles.member}</option>
                      <option value="admin">{m.team.roles.admin}</option>
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
