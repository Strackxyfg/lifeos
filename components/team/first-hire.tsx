"use client";

import { useMemo, useState } from "react";
import { BookOpenCheck, Check, Loader2, Pin, PinOff, Share2, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { TeamNoteView, TeamPageView } from "@/lib/team/view";
import { pinTeamNote, shareNotes } from "@/app/actions/team";
import { useTeamAction } from "./use-team-action";

/** Who keeps the team's welcome pack. */
export function canPin(view: TeamPageView): boolean {
  return view.me.role === "owner" || view.me.role === "admin";
}

/** Pins a shared note to the welcome pack, or takes it out. */
export function PinButton({ note, view }: { note: TeamNoteView; view: TeamPageView }) {
  const m = useMessages();
  const f = m.founder.team;
  const { run, pending } = useTeamAction();
  if (!canPin(view)) return null;
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={note.pinned}
      onClick={() => void run(() => pinTeamNote(view.team.id, note.id, !note.pinned))}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] transition-colors",
        note.pinned ? "text-accent hover:text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {note.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
      {note.pinned ? f.unpin : f.pin}
    </button>
  );
}

/**
 * The welcome pack: what a newcomer should read first, pinned by the
 * people who run the team. Shown to everyone, first.
 */
export function WelcomePack({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const f = m.founder.team;
  const pinned = view.notes.filter((n) => n.pinned);
  if (pinned.length === 0 && !canPin(view)) return null;
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <BookOpenCheck className="h-4 w-4 text-accent" aria-hidden />
        {f.pack}
      </h2>
      {pinned.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">{f.packEmpty}</p>
      ) : (
        <>
          <p className="mt-1 text-[0.72rem] uppercase tracking-[0.08em] text-muted">{f.packFor}</p>
          <ol className="mt-2 space-y-2">
            {pinned.map((n, i) => (
              <li key={n.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-[0.75rem] font-semibold text-accent">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.detail && <span className="mt-0.5 line-clamp-3 block whitespace-pre-line text-[0.8125rem] text-muted-foreground">{n.detail}</span>}
                  <span className="mt-1 block text-[0.72rem] text-muted">{n.authorName}</span>
                </span>
                <PinButton note={n} view={view} />
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

/**
 * Going from solo to a team, for its owner while they are still alone in
 * it: share what the first hire needs (several notes at once — copies, one
 * by one, never the whole brain), pin their welcome pack, invite them.
 */
export function FirstHire({ view }: { view: TeamPageView }) {
  const m = useMessages();
  const locale = useLocale();
  const f = m.founder.team;
  const { run, pending } = useTeamAction();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const shareable = useMemo(() => {
    const q = query.trim().toLowerCase();
    // How you work first: what you know and what you have learnt.
    const howYouWork = (c: string) => c === "knowledge" || c === "insights";
    const ranked = [...view.shareable].sort((a, b) => Number(howYouWork(b.category)) - Number(howYouWork(a.category)));
    return (q ? ranked.filter((n) => n.title.toLowerCase().includes(q)) : ranked).slice(0, 12);
  }, [view.shareable, query]);
  const mineShared = view.notes.filter((n) => n.mine);

  if (view.me.role !== "owner" || view.team.members > 1) return null;

  const step = (n: number, done: boolean, title: string) => (
    <span className="flex items-center gap-2 text-sm font-medium">
      <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[0.75rem]", done ? "bg-success/20 text-success" : "bg-accent/15 text-accent")}>
        {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
      </span>
      {title}
    </span>
  );

  return (
    <Card className="border-accent/30 p-5">
      <h2 className="text-base font-semibold">{f.title}</h2>
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">{f.subtitle}</p>

      <div className="mt-5 space-y-5">
        <section>
          {step(1, mineShared.length > 0, f.step2)}
          <p className="mt-1 pl-8 text-[0.75rem] text-muted">{f.step2Hint}</p>
          <div className="mt-2 pl-8">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.team.brain.pick}
              className="h-9 w-full rounded-lg border border-border bg-surface-2/60 px-3 text-sm outline-none focus:border-border-strong"
            />
            {!query && <p className="mt-1.5 text-[0.72rem] text-muted">{f.suggest}</p>}
            <ul className="mt-1 divide-y divide-border">
              {shareable.map((n) => (
                <li key={n.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.has(n.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(n.id);
                          else next.delete(n.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[hsl(var(--accent))]"
                    />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <span className="text-[0.72rem] text-muted">{m.brain.cat[n.category].label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={pending || picked.size === 0}
              onClick={async () => {
                const res = await run(() => shareNotes(view.team.id, [...picked]));
                if (res) setPicked(new Set());
              }}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-accent-foreground disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Share2 className="h-3.5 w-3.5" aria-hidden />}
              {plural(locale, picked.size, f.share)}
            </button>
          </div>
        </section>

        <section>
          {step(2, view.notes.some((n) => n.pinned), f.step3)}
          <p className="mt-1 pl-8 text-[0.75rem] text-muted">{f.step3Hint}</p>
          {mineShared.length > 0 && (
            <ul className="mt-2 space-y-1 pl-8">
              {mineShared.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{n.title}</span>
                  <PinButton note={n} view={view} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          {step(3, view.invites.some((i) => !i.revoked), f.step4)}
          <div className="mt-2 pl-8">
            <button
              type="button"
              onClick={() => {
                window.location.hash = "members";
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              {m.team.tabs.members}
            </button>
          </div>
        </section>
      </div>
    </Card>
  );
}
