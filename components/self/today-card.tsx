"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Flame, Loader2, MessageCircle, Mic, RefreshCw, Sparkles, Square, UserRound } from "lucide-react";
import { acceptDoubleAction, checkIn, type Accepted, type CheckinSaved } from "@/app/actions/self";
import type { DoubleAction } from "@/lib/self/double";
import type { Question } from "@/lib/self/questions";
import type { TraitLike } from "@/lib/self/portrait";
import type { SelfData } from "@/lib/self/store";
import { useDictation } from "@/components/brain/use-dictation";
import { toast } from "@/components/ui/toaster";
import { fill, plural } from "@/lib/i18n/config";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { TraitRow, type TraitHandlers } from "./trait-row";
import { DoubleReply } from "./double-reply";
import { streamDouble, type DoubleTurn } from "./double-stream";
import { careLevel } from "@/lib/self/care";
import { formatWhen } from "./advice-list";

type Checkin = SelfData["checkins"][number];

/** The words of a question, in the reader's language. */
export function questionText(q: Question, m: ReturnType<typeof useMessages>): string {
  if (q.kind === "goal") return fill(m.self.question.goal, { title: q.title });
  if (q.kind === "tension") return fill(m.self.question.tension, { a: q.a.title, b: q.b.title });
  return (m.self.questions as Record<string, string>)[q.id] ?? "";
}

function Scale({
  label,
  labels,
  value,
  onChange,
  tint,
}: {
  label: string;
  labels: string[];
  value: number | null;
  onChange: (v: number | null) => void;
  tint: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-16 shrink-0 text-[0.8rem] text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {labels.map((name, i) => {
          const v = i + 1;
          const on = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${v} — ${name}`}
              title={name}
              onClick={() => onChange(on ? null : v)}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md border font-mono text-[0.8rem] transition-colors",
                on ? "border-transparent text-background" : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
              )}
              style={on ? { background: tint } : undefined}
            >
              {v}
            </button>
          );
        })}
      </div>
      <span className="min-w-[5rem] text-[0.76rem] text-muted-foreground" aria-live="polite">
        {value ? labels[value - 1] : ""}
      </span>
    </div>
  );
}

export function TodayCard({
  name,
  zone,
  hour,
  todayCheckins,
  streak,
  questions,
  aiEnabled,
  onSaved,
  learn,
  traits,
  titles,
  handlers,
  onAccepted,
  onContinue,
}: {
  name: string | null;
  zone: string;
  /** The person's local hour, for the greeting. */
  hour: number;
  todayCheckins: Checkin[];
  streak: number;
  questions: Question[];
  aiEnabled: boolean;
  onSaved: (saved: CheckinSaved) => void;
  /** Has the double read a note for the portrait; the traits it proposed, or null if it could not. */
  learn: (noteId: string) => Promise<TraitLike[] | null>;
  /** The portrait as it stands, so a trait judged here shows its new state. */
  traits: Map<string, TraitLike>;
  titles: Map<string, string>;
  handlers: TraitHandlers;
  /** An action the double proposed in its reply, accepted. */
  onAccepted: (a: Accepted) => void;
  /** Carries the exchange on in the conversation: their answer and the double's reply. */
  onContinue: (turns: DoubleTurn[]) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const s = m.self;

  // ── Check-in ──
  // Asked until today has a mood or an energy — an answered question alone is not a check-in of how they are.
  const [editing, setEditing] = useState(() => !todayCheckins.some((c) => c.mood !== null || c.energy !== null));
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [savingCheckin, setSavingCheckin] = useState(false);
  const measured = [...todayCheckins].reverse().find((c) => c.mood !== null || c.energy !== null) ?? null;

  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: locale === "fr" ? "2-digit" : "numeric", minute: "2-digit", timeZone: zone }).format(new Date(iso));

  async function saveCheckin() {
    if (mood === null && energy === null) return;
    setSavingCheckin(true);
    const res = await checkIn({ mood, energy, zone, locale }).catch(() => null);
    setSavingCheckin(false);
    if (!res || !res.ok) return void toast(s.errors[res?.code ?? "failed"], "error");
    onSaved(res.data);
    setMood(null);
    setEnergy(null);
    setEditing(false);
  }

  // ── The day's question ──
  const [index, setIndex] = useState(0);
  const question = questions.length ? questions[index % questions.length] : null;
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<"ask" | "saving" | "replied">("ask");
  const [learned, setLearned] = useState<string[]>([]);
  /** What they answered, and the double's reply to it — streaming in, then with its actions. */
  const [exchange, setExchange] = useState<{ question: string; answer: string; reply: DoubleTurn; streaming: boolean; failed: boolean; continued?: boolean } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const dictation = useDictation({
    locale,
    onText: (text) => setAnswer(text),
    onError: () => toast(m.brain.voiceError, "error"),
  });

  async function submitAnswer() {
    const text = answer.trim();
    if (!question || !text || phase !== "ask") return;
    if (dictation.listening) dictation.stop();
    setPhase("saving");
    const res = await checkIn({ questionId: question.id, answer: text, zone, locale }).catch(() => null);
    if (!res || !res.ok) {
      setPhase("ask");
      return void toast(s.errors[res?.code ?? "failed"], "error");
    }
    onSaved(res.data);
    setAnswer("");
    setLearned([]);
    if (!aiEnabled || !res.data.note) {
      toast(s.question.kept);
      setExchange(null);
      return setPhase("replied");
    }
    // The double replies to what they confided — and, alongside, reads it for their portrait.
    const asked = questionText(question, m);
    const noteId = res.data.note.id;
    setExchange({ question: asked, answer: text, reply: { role: "assistant", content: "" }, streaming: true, failed: false });
    setPhase("replied");
    // A hard moment is how they are today, not who they are: it is answered, not read for the portrait.
    if (careLevel(text) === "none") void learn(noteId).then((traits) => setLearned((traits ?? []).map((t) => t.id)));
    const patch = (p: Partial<DoubleTurn>) => setExchange((x) => (x ? { ...x, reply: { ...x.reply, ...p } } : x));
    const out = await streamDouble({
      turns: [{ role: "user", content: text, question: asked }],
      mode: "answer",
      answerNote: noteId,
      locale,
      zone,
      questionLabel: s.talk.questionOfDay,
      onText: (content) => patch({ content }),
      onCare: (care) => patch({ care }),
    });
    setExchange((x) =>
      x
        ? {
            ...x,
            streaming: false,
            failed: !out.ok,
            // The answer they have just written is not a source of the reply to it.
            reply: { ...x.reply, content: out.text, actions: out.actions, sources: out.sources.filter((src) => src.id !== noteId), accepted: [], care: out.care },
          }
        : x
    );
  }

  async function accept(index: number, action: DoubleAction) {
    setBusy(index);
    const res = await acceptDoubleAction(action, { zone, locale }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      if (res?.code === "invalid" && action.type === "reminder") return void toast(fill(s.talk.whenUnclear, { when: action.when }), "error");
      return void toast(s.errors[res?.code ?? "failed"], "error");
    }
    onAccepted(res.data);
    setExchange((x) => (x ? { ...x, reply: { ...x.reply, accepted: [...(x.reply.accepted ?? []), index] } } : x));
    toast(res.data.reminder ? fill(s.advice.reminded, { when: formatWhen(res.data.reminder.dueAt, locale, zone) }) : s.talk.accepted);
  }

  function nextQuestion() {
    setPhase("ask");
    setLearned([]);
    setExchange(null);
    setIndex((i) => i + 1);
  }

  const greetingKey = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const learnedTraits = useMemo(() => learned.map((id) => traits.get(id)).filter((t): t is TraitLike => !!t && t.status !== "rejected"), [learned, traits]);

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[1.15rem] font-medium tracking-tight">{fill(s.greeting[greetingKey], { name: name ? `, ${name}` : "" })}</h2>
        {streak > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[0.72rem] text-muted-foreground">
            <Flame className="h-3 w-3 text-[#d97706]" /> {plural(locale, streak, s.checkin.streak)}
          </span>
        )}
      </div>

      {/* How they are */}
      <div className="mt-4">
        <p className="text-[0.84rem] font-medium">{s.checkin.title}</p>
        {editing ? (
          <div className="mt-2.5 flex flex-col gap-2">
            <Scale label={s.checkin.mood} labels={s.checkin.moodScale} value={mood} onChange={setMood} tint="#d97706" />
            <Scale label={s.checkin.energy} labels={s.checkin.energyScale} value={energy} onChange={setEnergy} tint="#0284c7" />
            <div>
              <button
                type="button"
                onClick={() => void saveCheckin()}
                disabled={savingCheckin || (mood === null && energy === null)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background transition-opacity disabled:opacity-40"
              >
                {savingCheckin && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {s.checkin.save}
              </button>
            </div>
          </div>
        ) : (
          measured && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-muted-foreground">
              <span>{fill(s.checkin.saved, { time: time(measured.at) })}</span>
              {measured.mood !== null && (
                <span>
                  {s.checkin.mood} <span className="font-medium text-foreground">{s.checkin.moodScale[measured.mood - 1]}</span>
                </span>
              )}
              {measured.energy !== null && (
                <span>
                  {s.checkin.energy} <span className="font-medium text-foreground">{s.checkin.energyScale[measured.energy - 1]}</span>
                </span>
              )}
              <button type="button" onClick={() => setEditing(true)} className="text-[0.76rem] underline-offset-2 hover:text-foreground hover:underline">
                {s.checkin.again}
              </button>
            </div>
          )
        )}
      </div>

      {/* The day's question */}
      <div className="mt-5 border-t border-border pt-4">
        <p className="flex items-center gap-2 text-[0.78rem] font-medium text-accent">
          <Sparkles className="h-3.5 w-3.5" /> {s.question.title}
        </p>
        {!question ? (
          <p className="mt-2 text-[0.84rem] leading-relaxed text-muted-foreground">{s.question.allAnswered}</p>
        ) : phase === "ask" || phase === "saving" ? (
          <>
            <p className="mt-2 text-[1rem] leading-snug">{questionText(question, m)}</p>
            <p className="mt-1 text-[0.72rem] text-muted-foreground">
              {question.kind === "goal" ? s.question.whyGoal : question.kind === "tension" ? s.question.whyTension : `${s.question.why} · ${s.dimensions[question.dimension]}`}
            </p>
            <div className="mt-3 rounded-lg border border-border bg-surface-2/30 focus-within:border-border-strong">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submitAnswer();
                  }
                }}
                placeholder={dictation.listening ? m.brain.voiceListening : s.question.placeholder}
                aria-label={questionText(question, m)}
                maxLength={2000}
                rows={3}
                className="block w-full resize-none bg-transparent px-3 py-2.5 text-[0.88rem] outline-none placeholder:text-muted"
              />
              <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
                {dictation.supported && (
                  <button
                    type="button"
                    onClick={dictation.listening ? dictation.stop : dictation.start}
                    aria-pressed={dictation.listening}
                    title={`${dictation.listening ? s.question.stopDictating : s.question.dictate} — ${m.brain.voiceDisclosure}`}
                    aria-label={dictation.listening ? s.question.stopDictating : s.question.dictate}
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-md transition-colors",
                      dictation.listening ? "bg-danger/15 text-danger" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {dictation.listening ? <Square className="h-3 w-3" /> : <Mic className="h-3.5 w-3.5" />}
                  </button>
                )}
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIndex((i) => i + 1);
                      setAnswer("");
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.74rem] text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" /> {s.question.another}
                  </button>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void submitAnswer()}
                  disabled={!answer.trim() || phase === "saving"}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-[0.76rem] font-medium text-background transition-opacity disabled:opacity-40"
                >
                  {phase === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} {s.question.answer}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-3">
            {exchange ? (
              <>
                <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-surface-2 px-3 py-2 text-[0.84rem] leading-relaxed">
                  <span className="mb-0.5 block text-[0.7rem] text-muted-foreground">{exchange.question}</span>
                  <span className="whitespace-pre-wrap">{exchange.answer}</span>
                </div>
                <div className="mt-3 flex gap-2.5" aria-live="polite">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-accent" aria-hidden>
                    <UserRound className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="sr-only">{s.talk.double}:</p>
                    {exchange.failed && !exchange.reply.content ? (
                      <p className="text-[0.84rem] leading-relaxed text-muted-foreground">{s.question.replyFailed}</p>
                    ) : (
                      <DoubleReply turn={exchange.reply} busy={busy} onAccept={(i, a) => void accept(i, a)} />
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-[0.82rem] leading-relaxed text-muted-foreground" role="status">
                {s.question.kept}
              </p>
            )}
            {learnedTraits.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-[0.78rem] font-medium">{s.question.learned}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {learnedTraits.map((t) => (
                    <TraitRow key={t.id} trait={t} quotes={t.evidence.map((e) => ({ ...e, title: titles.get(e.noteId) ?? "" }))} handlers={handlers} compact />
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {exchange && !exchange.streaming && (
                <button
                  type="button"
                  onClick={() => {
                    // Once in the conversation, the exchange is not added again: a second click only goes there.
                    if (exchange.continued) return onContinue([]);
                    const turns: DoubleTurn[] = [{ role: "user", content: exchange.answer, question: exchange.question }];
                    if (exchange.reply.content) turns.push(exchange.reply);
                    onContinue(turns);
                    setExchange((x) => (x ? { ...x, continued: true } : x));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[0.78rem] font-medium text-background [@media(pointer:coarse)]:py-2"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> {s.question.continue}
                </button>
              )}
              <button
                type="button"
                onClick={nextQuestion}
                disabled={exchange?.streaming}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[0.76rem] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" /> {s.question.another}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
