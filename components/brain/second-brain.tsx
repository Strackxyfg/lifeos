"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, ArrowLeft, ArrowUp, Mic, Sparkles, Check, Circle, CornerRightDown,
} from "lucide-react";
import { categories, type BrainCategoryId, type BrainItemKind } from "@/lib/data/brain";
import { createBrainItem, setBrainItemDone } from "@/app/actions/workspace";
import type { DbBrainItem } from "@/lib/db/types";
import type { Messages } from "@/lib/i18n/dictionaries";
import { toast } from "@/components/ui/toaster";
import { useMessages, useLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

const BrainScene = dynamic(() => import("./brain-scene").then((m) => m.BrainScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Brain className="h-8 w-8 animate-pulse text-accent" />
    </div>
  ),
});

const kindForCategory: Record<BrainCategoryId, BrainItemKind> = {
  ideas: "idea",
  thoughts: "thought",
  next: "task",
  knowledge: "note",
  insights: "insight",
};

/** Seeded rows resolve their text from i18n; captured rows carry their own. */
function itemText(item: DbBrainItem, m: Messages): { title: string; detail?: string } {
  if (item.title) return { title: item.title, detail: item.detail ?? undefined };
  const seeded = item.seedKey ? m.brain.items[item.seedKey] : undefined;
  return { title: seeded?.title ?? "", detail: seeded?.detail };
}

export function SecondBrain({ items: initialItems }: { items: DbBrainItem[] }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<BrainCategoryId | null>(null);
  const [items, setItems] = useState<DbBrainItem[]>(initialItems);
  const [draft, setDraft] = useState("");

  const labels = useMemo(
    () =>
      categories.reduce(
        (acc, c) => ({ ...acc, [c.id]: m.brain.cat[c.id].label }),
        {} as Record<BrainCategoryId, string>
      ),
    [m]
  );

  const counts = useMemo(() => {
    const by = (id: BrainCategoryId) => items.filter((i) => i.category === id).length;
    return { ideas: by("ideas"), thoughts: by("thoughts"), insights: by("insights") };
  }, [items]);

  const capture = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");

    // Show it immediately, then let the AI classify and the DB persist it.
    const tempId = `temp-${Date.now()}`;
    const optimistic: DbBrainItem = {
      id: tempId,
      userKey: "",
      createdAt: new Date().toISOString(),
      category: "thoughts",
      kind: "thought",
      seedKey: null,
      title,
      detail: null,
      done: false,
      ai: false,
    };
    setItems((prev) => [optimistic, ...prev]);
    setSelected("thoughts");

    let category: BrainCategoryId = "thoughts";
    let note: string | null = null;
    try {
      const res = await fetch("/api/brain/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: title, locale }),
      });
      const data = (await res.json()) as { category?: BrainCategoryId; note?: string };
      category = data.category ?? "thoughts";
      note = data.note ?? null;
    } catch {
      /* fall through with the default category */
    }

    const kind = kindForCategory[category];
    setItems((prev) =>
      prev.map((i) => (i.id === tempId ? { ...i, category, kind, detail: note, ai: true } : i))
    );
    setSelected(category);

    const saved = await createBrainItem({ title, category, kind, detail: note ?? undefined, ai: true });
    if (saved.ok) {
      toast(m.brain.captured);
      router.refresh(); // pull back the persisted row (real id)
    } else {
      setItems((prev) => prev.filter((i) => i.id !== tempId));
      toast(saved.error, "error");
    }
  };

  const toggleTask = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    const next = !target.done;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: next } : i)));
    setBrainItemDone(id, next).then((res) => {
      if (!res.ok) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !next } : i)));
    });
  };

  return (
    <div className="grid overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[1fr_360px]">
      {/* ── 3D stage ─────────────────────────────────────────── */}
      <div className="relative min-h-[56vh] lg:min-h-[72vh]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(58% 58% at 50% 42%, rgba(34,211,238,0.12), transparent 72%)" }}
        />
        <div className="absolute inset-0">
          <BrainScene selected={selected} onSelect={setSelected} labels={labels} />
        </div>

        {/* HUD */}
        <div className="pointer-events-none absolute left-5 top-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4 text-accent" /> {m.nav.brain}
          </div>
          <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground">
            {counts.ideas} {m.brain.hudIdeas} · {counts.thoughts} {m.brain.hudThoughts} · {counts.insights} {m.brain.hudInsights}
          </p>
        </div>
        <div className="pointer-events-none absolute right-5 top-5 hidden items-center gap-1.5 rounded-full border border-border bg-surface/60 px-2.5 py-1 text-[0.7rem] text-muted-foreground backdrop-blur sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> {m.brain.dragHint}
        </div>

        {/* Capture bar */}
        <div className="absolute inset-x-4 bottom-4">
          <div className="mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-border bg-surface/80 px-3 py-1.5 backdrop-blur focus-within:border-border-strong">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && capture()}
              placeholder={m.brain.capturePlaceholder}
              className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            <button className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:text-foreground" aria-label={m.brain.voice}>
              <Mic className="h-4 w-4" />
            </button>
            <button
              onClick={capture}
              disabled={!draft.trim()}
              className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
              aria-label={m.brain.capture}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Side panel ───────────────────────────────────────── */}
      <aside className="flex min-h-0 flex-col border-t border-border lg:max-h-[72vh] lg:border-l lg:border-t-0">
        <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
          {categories.map((c) => {
            const activeChip = selected === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelected(activeChip ? null : c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.78rem] transition-colors",
                  activeChip ? "text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                )}
                style={activeChip ? { borderColor: `${c.color}66`, background: `${c.color}14` } : undefined}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                {labels[c.id]}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AnimatePresence mode="wait">
            {selected ? (
              <CategoryPanel key={selected} id={selected} items={items} onBack={() => setSelected(null)} onToggle={toggleTask} />
            ) : (
              <Overview key="overview" onOpenNext={() => setSelected("next")} onPick={setSelected} />
            )}
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}

function Overview({ onOpenNext, onPick }: { onOpenNext: () => void; onPick: (id: BrainCategoryId) => void }) {
  const m = useMessages();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.24, ease }}>
      <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-4">
        <div className="flex items-center gap-2 text-[0.78rem] font-medium text-accent">
          <Sparkles className="h-3.5 w-3.5" /> {m.brain.focusTitle}
        </div>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-foreground/85">{m.brain.focusBody}</p>
        <button onClick={onOpenNext} className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-accent hover:underline">
          {m.brain.openNext} <CornerRightDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-2 mt-6 text-[0.7rem] uppercase tracking-wider text-muted">{m.brain.regions}</p>
      <div className="grid grid-cols-2 gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            className="group flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong"
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${c.color}18`, color: c.color }}>
              <c.icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.82rem] font-medium">{m.brain.cat[c.id].label}</span>
              <span className="block truncate text-[0.72rem] text-muted-foreground">{m.brain.cat[c.id].blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function CategoryPanel({
  id,
  items,
  onBack,
  onToggle,
}: {
  id: BrainCategoryId;
  items: DbBrainItem[];
  onBack: () => void;
  onToggle: (id: string) => void;
}) {
  const m = useMessages();
  const cat = categories.find((c) => c.id === id)!;
  const list = items.filter((i) => i.category === id);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.24, ease }}>
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[0.8rem] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {m.brain.overview}
      </button>

      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${cat.color}18`, color: cat.color }}>
          <cat.icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-[1.05rem] font-medium tracking-tight">{m.brain.cat[id].label}</h3>
          <p className="text-[0.75rem] text-muted-foreground">{m.brain.cat[id].blurb}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {list.map((it) => {
          const { title, detail } = itemText(it, m);
          return it.kind === "task" ? (
            <button
              key={it.id}
              onClick={() => onToggle(it.id)}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong"
            >
              {it.done ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-border-strong" />}
              <span className={cn("text-[0.875rem] leading-snug", it.done && "text-muted-foreground line-through")}>
                {title}
                {it.ai && <AiTag />}
              </span>
            </button>
          ) : (
            <div key={it.id} className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[0.875rem] leading-snug">
                {title}
                {it.ai && <AiTag />}
              </p>
              {detail && <p className="mt-1 text-[0.78rem] leading-relaxed text-muted-foreground">{detail}</p>}
            </div>
          );
        })}
        {list.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {m.brain.nothingHere}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function AiTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 align-middle text-[0.6rem] font-medium text-accent">
      <Sparkles className="h-2.5 w-2.5" /> AI
    </span>
  );
}
